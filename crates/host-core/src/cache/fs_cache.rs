//! Mtime-keyed in-memory file cache.
//!
//! Maps `PathBuf -> CachedFile` behind `std::sync::RwLock`. `get_or_load`
//! stats `modified()` first: unchanged mtime returns cached `Arc` references
//! with zero filesystem I/O beyond the stat call.

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

/// One cached file: text, line offsets, and content hash.
#[derive(Debug, Clone)]
pub struct CachedFile {
    /// Last-modified time observed at load.
    pub mtime: SystemTime,
    /// Full file text (LF-normalized by the caller when needed).
    pub content: Arc<String>,
    /// Byte offset where each line starts; `line_offsets.len()` == line count.
    pub line_offsets: Arc<Vec<usize>>,
    /// SHA256 hex of `content`.
    pub hash: String,
}

impl CachedFile {
    /// Number of lines.
    pub fn line_count(&self) -> usize {
        self.line_offsets.len()
    }

    /// Line slice `offset..offset+limit` (0-based), without trailing newline.
    pub fn window(&self, offset: usize, limit: usize) -> Vec<(usize, &str)> {
        let text = self.content.as_str();
        let total = self.line_count();
        let end = (offset.saturating_add(limit)).min(total);
        (offset.min(total)..end)
            .map(|n| {
                let start = self.line_offsets[n];
                let stop = self.line_offsets.get(n + 1).copied().unwrap_or(text.len());
                (n, text[start..stop].trim_end_matches('\n'))
            })
            .collect()
    }
}

/// Thread-safe file cache. Clone shares the same backing map.
#[derive(Debug, Default, Clone)]
pub struct FsCache {
    inner: Arc<RwLock<HashMap<PathBuf, CachedFile>>>,
}

impl FsCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Cached entries currently held.
    pub fn len(&self) -> usize {
        self.inner.read().map(|m| m.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Drop one path from the cache.
    pub fn invalidate(&self, path: &Path) {
        if let Ok(mut map) = self.inner.write() {
            map.remove(path);
        }
    }

    /// Drop everything (memory-pressure path).
    pub fn clear(&self) {
        if let Ok(mut map) = self.inner.write() {
            map.clear();
        }
    }

    /// Load `path`, or return the cached copy when mtime is unchanged.
    pub fn get_or_load(&self, path: &Path) -> Result<CachedFile> {
        let mtime = std::fs::metadata(path)
            .with_context(|| format!("stat failed: {}", path.display()))?
            .modified()
            .with_context(|| format!("mtime unavailable: {}", path.display()))?;
        if let Ok(map) = self.inner.read() {
            if let Some(hit) = map.get(path) {
                if hit.mtime == mtime {
                    return Ok(hit.clone());
                }
            }
        }
        let bytes = std::fs::read(path)
            .with_context(|| format!("read failed: {}", path.display()))?;
        let text = String::from_utf8(bytes)
            .with_context(|| format!("non-UTF8 file: {}", path.display()))?;
        let mut offsets = Vec::new();
        let mut at = 0usize;
        for line in text.split_inclusive('\n') {
            offsets.push(at);
            at += line.len();
        }
        if offsets.is_empty() || text.ends_with('\n') && at == text.len() {
            // text.split_inclusive on "" yields nothing; guard the empty file.
            if text.is_empty() {
                offsets.clear();
            }
        }
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let hash = hex::encode(hasher.finalize());
        let cached = CachedFile {
            mtime,
            content: Arc::new(text),
            line_offsets: Arc::new(offsets),
            hash,
        };
        if let Ok(mut map) = self.inner.write() {
            map.insert(path.to_path_buf(), cached.clone());
        }
        Ok(cached)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(content: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("a.txt");
        let mut f = std::fs::File::create(&path).expect("create");
        f.write_all(content.as_bytes()).expect("write");
        (dir, path)
    }

    #[test]
    fn caches_second_read_without_io_beyond_stat() {
        let (_dir, path) = fixture("one\ntwo\nthree\n");
        let cache = FsCache::new();
        let first = cache.get_or_load(&path).expect("load");
        assert_eq!(first.line_count(), 3);
        assert_eq!(cache.len(), 1);
        let second = cache.get_or_load(&path).expect("reload");
        assert_eq!(second.hash, first.hash);
        assert!(Arc::ptr_eq(&second.content, &first.content));
    }

    #[test]
    fn invalidates_on_mtime_change() {
        let (_dir, path) = fixture("v1\n");
        let cache = FsCache::new();
        let first = cache.get_or_load(&path).expect("load");
        std::thread::sleep(std::time::Duration::from_millis(25));
        std::fs::write(&path, "v2 changed\n").expect("rewrite");
        // Force a distinct mtime on coarse filesystems.
        let later = first.mtime + std::time::Duration::from_secs(5);
        let f = std::fs::File::options().write(true).open(&path).expect("open");
        f.set_modified(later).expect("touch");
        drop(f);
        let second = cache.get_or_load(&path).expect("reload");
        assert_ne!(second.hash, first.hash);
        assert_eq!(second.content.as_str(), "v2 changed\n");
    }

    #[test]
    fn windows_slice_offsets() {
        let (_dir, path) = fixture("a\nb\nc\nd\n");
        let cache = FsCache::new();
        let file = cache.get_or_load(&path).expect("load");
        let window = file.window(1, 2);
        assert_eq!(window, vec![(1, "b"), (2, "c")]);
    }
}
