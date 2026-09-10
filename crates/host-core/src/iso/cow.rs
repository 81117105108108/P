//! Fast workspace snapshots: reflink clone first, recursive copy fallback.
//!
//! macOS APFS clones and Linux reflinks allocate zero bytes up front and
//! typically finish in <20 ms for project trees. Every path degrades to a
//! plain recursive copy, so snapshots work on any filesystem.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

/// How the snapshot was produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloneMethod {
    /// APFS clone / filesystem reflink (zero-byte).
    Reflink,
    /// Plain recursive copy fallback.
    Copy,
}

/// Snapshot `base` into `dest`. Returns the method plus elapsed ms.
pub fn snapshot_dir(base: &Path, dest: &Path) -> Result<(CloneMethod, u128)> {
    if dest.exists() {
        anyhow::bail!("snapshot destination exists: {}", dest.display());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("snapshot parent: {}", parent.display()))?;
    }
    let started = Instant::now();
    // The destination lives inside the source tree (`.pi/worktrees/...`), so
    // a blind recursive clone would copy the snapshot into itself. Reflink
    // tools cannot exclude a subtree — copy with the destination skipped.
    if dest.starts_with(base) {
        copy_dir_with_skip(base, dest, Some(dest))?;
        return Ok((CloneMethod::Copy, started.elapsed().as_millis()));
    }
    if try_reflink(base, dest).is_ok() {
        return Ok((CloneMethod::Reflink, started.elapsed().as_millis()));
    }
    copy_dir(base, dest)?;
    Ok((CloneMethod::Copy, started.elapsed().as_millis()))
}

fn try_reflink(base: &Path, dest: &Path) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("cp")
            .args(["-c", "-R"])
            .arg(base)
            .arg(dest)
            .status()
            .context("cp -c")?;
        return if status.success() {
            Ok(())
        } else {
            anyhow::bail!("reflink copy failed: {status}")
        };
    }
    #[cfg(target_os = "linux")]
    {
        let status = Command::new("cp")
            .args(["--reflink=auto", "-a"])
            .arg(base)
            .arg(dest)
            .status()
            .context("cp --reflink")?;
        return if status.success() {
            Ok(())
        } else {
            anyhow::bail!("reflink copy failed: {status}")
        };
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (base, dest);
        anyhow::bail!("no reflink path on this OS")
    }
}

/// Plain recursive copy honoring symlinks-as-files (never follows).
pub fn copy_dir(base: &Path, dest: &Path) -> Result<()> {
    copy_dir_with_skip(base, dest, None)
}

/// Like [`copy_dir`] but skips `skip` (and everything under it). Required
/// when the snapshot directory lives inside the source tree.
pub fn copy_dir_with_skip(base: &Path, dest: &Path, skip: Option<&Path>) -> Result<()> {
    for entry in walkdir::WalkDir::new(base)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| skip.is_none_or(|s| e.path() != s))
    {
        let entry = entry.with_context(|| format!("walk {}", base.display()))?;
        let rel = entry
            .path()
            .strip_prefix(base)
            .with_context(|| "strip prefix")?;
        let target = dest.join(rel);
        let ft = entry.file_type();
        if ft.is_dir() {
            std::fs::create_dir_all(&target)
                .with_context(|| format!("mkdir {}", target.display()))?;
        } else if ft.is_symlink() {
            let link = std::fs::read_link(entry.path()).with_context(|| "read link")?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(&link, &target).with_context(|| "symlink")?;
            #[cfg(windows)]
            {
                let _ = &link;
                std::fs::copy(entry.path(), &target).with_context(|| "copy link target")?;
            }
        } else if ft.is_file() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).with_context(|| "mkdir parent")?;
            }
            std::fs::copy(entry.path(), &target)
                .with_context(|| format!("copy {}", target.display()))?;
        }
    }
    Ok(())
}

/// Remove a snapshot directory.
pub fn discard_snapshot(dest: &Path) -> Result<()> {
    if dest.exists() {
        std::fs::remove_dir_all(dest)
            .with_context(|| format!("remove {}", dest.display()))?;
    }
    Ok(())
}

/// Snapshot path for a task id (mirrors `shared/subagent-workspace`).
pub fn snapshot_path(root: &Path, task_id: &str) -> PathBuf {
    let clean: String = task_id
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let clean = if clean.is_empty() { "task".into() } else { clean };
    root.join(".pi").join("worktrees").join(format!("task-{clean}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshots_and_discards() {
        let base = tempfile::tempdir().expect("base");
        std::fs::write(base.path().join("a.txt"), "hello\n").expect("write");
        std::fs::create_dir(base.path().join("sub")).expect("mkdir");
        std::fs::write(base.path().join("sub").join("b.txt"), "world\n").expect("write");
        let dest = snapshot_path(base.path(), "A1_B2");
        assert!(dest.to_string_lossy().contains(".pi"));
        let (method, _ms) = snapshot_dir(base.path(), &dest).expect("snapshot");
        assert!(dest.join("a.txt").is_file());
        assert!(dest.join("sub").join("b.txt").is_file());
        let _ = method;
        discard_snapshot(&dest).expect("discard");
        assert!(!dest.exists());
    }

    #[test]
    fn refuses_existing_destination() {
        let base = tempfile::tempdir().expect("base");
        assert!(snapshot_dir(base.path(), base.path()).is_err());
    }
}
