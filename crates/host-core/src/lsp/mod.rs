//! Embedded multi-language LSP client multiplexer (ADR 0209).
//!
//! Supervises long-lived language servers over stdio JSON-RPC and exposes
//! semantic navigation (diagnostics, goto-def, references, hover, rename).
//! Transport framing and request builders are pure and unit-tested; process
//! supervision rides the existing tokio runtime.

pub mod client;
pub mod handlers;
pub mod session;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

/// Language servers this host knows how to discover, in preference order.
pub const KNOWN_SERVERS: &[(&str, &[&str])] = &[
    ("rust", &["rust-analyzer"]),
    ("typescript", &["vtsls", "typescript-language-server"]),
    ("python", &["basedpyright", "pyright"]),
    ("go", &["gopls"]),
];

/// Map a file extension to a language key.
pub fn language_for(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|e| e.to_str()) {
        Some("rs") => Some("rust"),
        Some("ts") | Some("tsx") | Some("js") | Some("jsx") | Some("mts") => Some("typescript"),
        Some("py") => Some("python"),
        Some("go") => Some("go"),
        _ => None,
    }
}

/// First installed server binary for `language`, or `None`.
pub fn discover_server(language: &str) -> Option<PathBuf> {
    let (_, candidates) = KNOWN_SERVERS.iter().find(|(l, _)| *l == language)?;
    candidates.iter().find_map(|bin| {
        let found = which::which(bin).ok()?;
        Some(found)
    })
}

/// Monotonic JSON-RPC request ids, shared across supervised servers.
#[derive(Debug, Default)]
pub struct IdCounter(AtomicI64);

impl IdCounter {
    pub fn next(&self) -> i64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }
}

/// Registry of live server handles by language.
#[derive(Debug, Default, Clone)]
pub struct LspManager {
    inner: Arc<Mutex<HashMap<String, String>>>,
    pub ids: Arc<IdCounter>,
}

impl LspManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a started server binary for `language`.
    pub fn register(&self, language: &str, binary: String) {
        if let Ok(mut map) = self.inner.lock() {
            map.insert(language.to_string(), binary);
        }
    }

    /// Binary currently serving `language`, if any.
    pub fn serving(&self, language: &str) -> Option<String> {
        self.inner.lock().ok()?.get(language).cloned()
    }
}

/// Extra argv a server needs for stdio mode.
pub fn stdio_args(binary: &std::path::Path) -> Vec<String> {
    let name = binary
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if name.contains("typescript-language-server") || name == "vtsls" {
        vec!["--stdio".into()]
    } else if name.contains("pyright") {
        vec!["--stdio".into()]
    } else if name == "gopls" {
        vec!["serve".into()]
    } else {
        Vec::new()
    }
}

/// Outcome of a one-shot supervised LSP exchange.
#[derive(Debug)]
pub struct LspExchange {
    /// `result` of the awaited request id.
    pub result: serde_json::Value,
    /// `publishDiagnostics` payloads seen for the file while waiting.
    pub diagnostics: Vec<serde_json::Value>,
}

/// Spawn `binary`, run initialize → initialized → didOpen → one request, and
/// return the request result plus any diagnostics observed within `timeout`.
/// The child is always killed before returning.
async fn write_msg(
    stdin: &mut tokio::process::ChildStdin,
    value: &serde_json::Value,
) -> anyhow::Result<()> {
    use tokio::io::AsyncWriteExt;
    let framed = client::encode_message(value);
    stdin.write_all(&framed).await?;
    stdin.flush().await?;
    Ok(())
}

pub async fn query_once(
    binary: &std::path::Path,
    root: &Path,
    language_id: &str,
    file: &Path,
    file_text: &str,
    method: &str,
    params: serde_json::Value,
    timeout: std::time::Duration,
) -> anyhow::Result<LspExchange> {
    let mut child = tokio::process::Command::new(binary)
        .args(stdio_args(binary))
        .current_dir(root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| anyhow::anyhow!("lsp spawn failed: {e}"))?;
    let run = async {
        let mut stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("no stdout"))?;
        let mut reader = tokio::io::BufReader::new(stdout);
        let mut next_id: i64 = 0;
        next_id += 1;
        let init_id = next_id;
        write_msg(&mut stdin, &client::request(next_id, "initialize", handlers::initialize(root))).await?;
        write_msg(
            &mut stdin,
            &client::notification("initialized", serde_json::json!({})),
        )
        .await?;
        write_msg(
            &mut stdin,
            &client::notification(
                "textDocument/didOpen",
                handlers::did_open(file, language_id, file_text),
            ),
        )
        .await?;
        next_id += 1;
        let want = next_id;
        write_msg(&mut stdin, &client::request(next_id, method, params)).await?;
        let mut diagnostics = Vec::new();
        let result = loop {
            let msg =
                client::read_message(&mut reader, 8 * 1024 * 1024).await?;
            if msg.get("id") == Some(&serde_json::json!(init_id)) {
                continue;
            }
            if msg.get("method") == Some(&serde_json::json!("textDocument/publishDiagnostics")) {
                diagnostics.push(msg.get("params").cloned().unwrap_or_default());
                continue;
            }
            if msg.get("id") == Some(&serde_json::json!(want)) {
                if let Some(err) = msg.get("error") {
                    anyhow::bail!("lsp {method} error: {err}");
                }
                break msg.get("result").cloned().unwrap_or_default();
            }
        };
        // Graceful shutdown, best effort.
        next_id += 1;
        let _ = write_msg(
            &mut stdin,
            &client::request(next_id, "shutdown", serde_json::json!(null)),
        )
        .await;
        let _ = write_msg(
            &mut stdin,
            &client::notification("exit", serde_json::json!(null)),
        )
        .await;
        anyhow::Result::<LspExchange>::Ok(LspExchange { result, diagnostics })
    };
    let outcome = tokio::time::timeout(timeout, run).await;
    let _ = child.kill().await;
    match outcome {
        Err(_) => anyhow::bail!("lsp {method} timed out"),
        Ok(r) => r,
    }
}

// `which` is not a dependency: resolve via PATH scan to stay dep-free.
mod which {
    use std::path::PathBuf;

    pub fn which(bin: &str) -> Result<PathBuf, ()> {
        let path = std::env::var_os("PATH").ok_or(())?;
        for dir in std::env::split_paths(&path) {
            #[cfg(windows)]
            {
                for ext in ["exe", "cmd", "bat"] {
                    let c = dir.join(format!("{bin}.{ext}"));
                    if c.is_file() {
                        return Ok(c);
                    }
                }
            }
            let c = dir.join(bin);
            #[cfg(not(windows))]
            {
                if c.is_file() {
                    return Ok(c);
                }
            }
            #[cfg(windows)]
            {
                if c.is_file() {
                    return Ok(c);
                }
            }
        }
        Err(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_extensions_to_languages() {
        assert_eq!(language_for(Path::new("a.rs")), Some("rust"));
        assert_eq!(language_for(Path::new("a.tsx")), Some("typescript"));
        assert_eq!(language_for(Path::new("a.py")), Some("python"));
        assert_eq!(language_for(Path::new("a.md")), None);
    }

    #[test]
    fn ids_increase_monotonically() {
        let c = IdCounter::default();
        assert!(c.next() < c.next());
    }

    #[test]
    fn registry_round_trips() {
        let m = LspManager::new();
        assert_eq!(m.serving("rust"), None);
        m.register("rust", "/bin/rust-analyzer".into());
        assert_eq!(m.serving("rust").as_deref(), Some("/bin/rust-analyzer"));
    }
}
