//! Long-lived multiplexed LSP sessions (ADR 0210).
//!
//! One supervised server per `(language, root)`: requests multiplex over a
//! single stdio pump with per-id routing, diagnostics accumulate per file,
//! and dead servers restart transparently on next use. `query_once` stays as
//! the one-shot path; tools prefer the process-wide [`POOL`].

use super::client;
use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

/// Live session: framed writer + pending-request router + diagnostics store.
pub struct Session {
    writer: Arc<tokio::sync::Mutex<Box<dyn tokio::io::AsyncWrite + Unpin + Send>>>,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<Value>>>>,
    diagnostics: Arc<Mutex<Vec<(String, Value)>>>,
    alive: Arc<AtomicBool>,
    ids: Arc<AtomicI64>,
    child: Option<Arc<tokio::sync::Mutex<tokio::process::Child>>>,
    /// Monotonic document versions per URI for didOpen.
    versions: Arc<Mutex<HashMap<String, i32>>>,
}

impl Session {
    fn wrap(
        writer: Box<dyn tokio::io::AsyncWrite + Unpin + Send>,
        reader: Box<dyn tokio::io::AsyncRead + Unpin + Send>,
        child: Option<tokio::process::Child>,
    ) -> Arc<Self> {
        let session = Arc::new(Session {
            writer: Arc::new(tokio::sync::Mutex::new(writer)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            diagnostics: Arc::new(Mutex::new(Vec::new())),
            alive: Arc::new(AtomicBool::new(true)),
            ids: Arc::new(AtomicI64::new(0)),
            child: child.map(|c| Arc::new(tokio::sync::Mutex::new(c))),
            versions: Arc::new(Mutex::new(HashMap::new())),
        });
        session.spawn_pump(reader);
        session
    }

    /// Spawn `binary` for `root` and return an uninitialized session.
    /// Call [`Session::initialize`] before requests.
    pub async fn spawn(binary: &Path, root: &Path) -> Result<Arc<Self>> {
        let mut child = tokio::process::Command::new(binary)
            .args(super::stdio_args(binary))
            .current_dir(root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .with_context(|| format!("lsp spawn: {}", binary.display()))?;
        let stdin: Box<dyn tokio::io::AsyncWrite + Unpin + Send> =
            Box::new(child.stdin.take().context("lsp child stdin")?);
        let stdout: Box<dyn tokio::io::AsyncRead + Unpin + Send> =
            Box::new(child.stdout.take().context("lsp child stdout")?);
        Ok(Self::wrap(stdin, stdout, Some(child)))
    }

    /// Test seam: session over in-memory duplex streams (no child process).
    #[cfg(test)]
    pub fn from_duplex(
        reader: tokio::io::DuplexStream,
        writer: tokio::io::DuplexStream,
    ) -> Arc<Self> {
        Self::wrap(Box::new(writer), Box::new(reader), None)
    }

    fn spawn_pump(&self, reader: Box<dyn tokio::io::AsyncRead + Unpin + Send>) {
        let pending = self.pending.clone();
        let diagnostics = self.diagnostics.clone();
        let alive = self.alive.clone();
        tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(reader);
            loop {
                match client::read_message(&mut reader, 8 * 1024 * 1024).await {                    Err(_) => break,
                    Ok(msg) => {
                        if msg.get("method")
                            == Some(&Value::String(
                                "textDocument/publishDiagnostics".into(),
                            ))
                        {
                            let uri = msg
                                .pointer("/params/uri")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let params = msg.get("params").cloned().unwrap_or_default();
                            if let Ok(mut d) = diagnostics.lock() {
                                d.retain(|(u, _)| u != &uri);
                                d.push((uri, params));
                                if d.len() > 50 {
                                    let excess = d.len() - 50;
                                    d.drain(..excess);
                                }
                            }
                            continue;
                        }
                        if let Some(id) = msg.get("id").and_then(|v| v.as_i64()) {
                            let tx = pending.lock().ok().and_then(|mut p| p.remove(&id));
                            if let Some(tx) = tx {
                                let _ = tx.send(msg);
                            }
                        }
                    }
                }
            }
            alive.store(false, Ordering::SeqCst);
        });
    }

    /// Initialize handshake against `root`.
    pub async fn initialize(self: &Arc<Self>, root: &Path) -> Result<Value> {
        let params = super::handlers::initialize(root);
        let reply = self.request("initialize", params).await?;
        if let Some(err) = reply.get("error") {
            anyhow::bail!("lsp initialize error: {err}");
        }
        self.notify("initialized", Value::Object(Default::default()))
            .await?;
        Ok(reply.get("result").cloned().unwrap_or_default())
    }

    /// Open (or re-open with bumped version) a document.
    pub async fn did_open(&self, path: &Path, language_id: &str, text: &str) -> Result<()> {
        let uri = super::handlers::file_uri(path);
        let version = {
            let mut versions = self.versions.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
            let version = versions.get(&uri).copied().unwrap_or(0) + 1;
            versions.insert(uri, version);
            version
        };
        let mut params =
            super::handlers::did_open(path, language_id, text).as_object().cloned().unwrap_or_default();
        if let Some(doc) = params.get_mut("textDocument").and_then(|d| d.as_object_mut()) {
            doc.insert("version".into(), Value::from(version));
        }
        self.notify("textDocument/didOpen", Value::Object(params)).await
    }

    /// Send a request and await its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        use tokio::io::AsyncWriteExt;
        let id = self.ids.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .map_err(|e| anyhow::anyhow!("{e}"))?
            .insert(id, tx);
        let framed = client::encode_message(&client::request(id, method, params));
        {
            let mut w = self.writer.lock().await;
            w.write_all(&framed).await.context("lsp write")?;
            w.flush().await.context("lsp flush")?;
        }
        tokio::time::timeout(std::time::Duration::from_secs(20), rx)
            .await
            .context("lsp request timed out")?
            .context("lsp pump died")
    }

    /// Send a notification.
    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        use tokio::io::AsyncWriteExt;
        let framed = client::encode_message(&client::notification(method, params));
        let mut w = self.writer.lock().await;
        w.write_all(&framed).await.context("lsp write")?;
        w.flush().await.context("lsp flush")?;
        Ok(())
    }

    /// Diagnostics last published for `uri` (file://).
    pub fn diagnostics_for(&self, uri: &str) -> Option<Value> {
        self.diagnostics
            .lock()
            .ok()?
            .iter()
            .rev()
            .find(|(u, _)| u == uri)
            .map(|(_, p)| p.clone())
    }

    /// False once the reader pump hit EOF/error or the child exited.
    pub fn is_alive(&self) -> bool {
        if !self.alive.load(Ordering::SeqCst) {
            return false;
        }
        if let Some(child) = &self.child {
            if let Ok(mut c) = child.try_lock() {
                if let Ok(Some(_)) = c.try_wait() {
                    return false;
                }
            }
        }
        true
    }

    /// Graceful shutdown + kill.
    pub async fn shutdown(&self) -> Result<()> {
        let id = self.ids.fetch_add(1, Ordering::SeqCst) + 1;
        let _ = self.write_raw(&client::request(id, "shutdown", Value::Null)).await;
        let _ = self
            .write_raw(&client::notification("exit", Value::Null))
            .await;
        if let Some(child) = &self.child {
            let mut c = child.lock().await;
            let _ = c.kill().await;
        }
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }

    async fn write_raw(&self, value: &Value) -> Result<()> {
        use tokio::io::AsyncWriteExt;
        let framed = client::encode_message(value);
        let mut w = self.writer.lock().await;
        w.write_all(&framed).await?;
        w.flush().await?;
        Ok(())
    }
}

/// Pool of live sessions keyed by `(language, root)`.
#[derive(Default)]
pub struct Pool {
    sessions: Mutex<HashMap<(String, PathBuf), Arc<Session>>>,
}

impl Pool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Live session for `(language, root)`, starting (and initializing) one
    /// when missing or dead. Restart is transparent to callers.
    pub async fn get_or_start(
        &self,
        language: &str,
        root: &Path,
        binary: &Path,
    ) -> Result<Arc<Session>> {
        let key = (language.to_string(), root.to_path_buf());
        if let Ok(map) = self.sessions.lock() {
            if let Some(s) = map.get(&key) {
                if s.is_alive() {
                    return Ok(s.clone());
                }
            }
        }
        let session = Session::spawn(binary, root).await?;
        session.initialize(root).await?;
        if let Ok(mut map) = self.sessions.lock() {
            map.insert(key, session.clone());
        }
        Ok(session)
    }

    /// One multiplexed exchange on the pooled session: didOpen, request,
    /// plus diagnostics observed for the file. Returns (result, diagnostics).
    pub async fn query(
        &self,
        language: &str,
        root: &Path,
        binary: &Path,
        language_id: &str,
        file: &Path,
        file_text: &str,
        method: &str,
        params: Value,
    ) -> Result<(Value, Vec<Value>)> {
        let session = self.get_or_start(language, root, binary).await?;
        session.did_open(file, language_id, file_text).await?;
        let reply = session.request(method, params).await?;
        if let Some(err) = reply.get("error") {
            anyhow::bail!("lsp {method} error: {err}");
        }
        let result = reply.get("result").cloned().unwrap_or_default();
        let uri = super::handlers::file_uri(file);
        let diagnostics = session
            .diagnostics_for(&uri)
            .and_then(|p| p.get("diagnostics").cloned())
            .and_then(|d| d.as_array().cloned())
            .unwrap_or_default();
        Ok((result, diagnostics))
    }

    /// Drop dead entries; returns live count.
    pub fn prune(&self) -> usize {        let mut live = 0;
        if let Ok(mut map) = self.sessions.lock() {
            map.retain(|_, s| {
                let ok = s.is_alive();
                if ok {
                    live += 1;
                }
                ok
            });
        }
        live
    }

    /// Shut every session down.
    pub async fn shutdown_all(&self) {
        let sessions: Vec<Arc<Session>> = self
            .sessions
            .lock()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        for s in sessions {
            let _ = s.shutdown().await;
        }
    }
}

/// Process-wide pool used by the `Lsp*` tools.
pub static POOL: std::sync::LazyLock<Pool> = std::sync::LazyLock::new(Pool::new);

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake server: answers `initialize` and any request, emits one
    /// diagnostics notification after initialize, exits on `exit`.
    async fn fake_server(
        mut read: tokio::io::DuplexStream,
        mut write: tokio::io::DuplexStream,
    ) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            let n = read.read(&mut tmp).await.unwrap_or(0);
            if n == 0 {
                return;
            }
            buf.extend_from_slice(&tmp[..n]);
            let (msgs, rest) = client::decode_buffer(&buf);
            buf = rest;
            for msg in msgs {
                let id = msg.get("id").and_then(|v| v.as_i64());
                let method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("");
                if method == "initialize" {
                    let reply = serde_json::json!({"jsonrpc": "2.0", "id": id, "result": {"ok": true}});
                    write.write_all(&client::encode_message(&reply)).await.unwrap();
                    let diag = serde_json::json!({
                        "jsonrpc": "2.0",
                        "method": "textDocument/publishDiagnostics",
                        "params": {"uri": "file:///a.rs", "diagnostics": [{"message": "unused"}]},
                    });
                    write.write_all(&client::encode_message(&diag)).await.unwrap();
                } else if method == "exit" {
                    return;
                } else if let Some(id) = id {
                    let reply = serde_json::json!({"jsonrpc": "2.0", "id": id, "result": {"pong": true}});
                    write.write_all(&client::encode_message(&reply)).await.unwrap();
                }
            }
        }
    }

    #[tokio::test]
    async fn multiplexes_requests_and_routes_diagnostics() {
        // Pair A carries server→client, pair B client→server.
        let (client_read, server_write) = tokio::io::duplex(64 * 1024);
        let (server_read, client_write) = tokio::io::duplex(64 * 1024);
        tokio::spawn(fake_server(server_read, server_write));
        let session = Session::from_duplex(client_read, client_write);
        let init = session.initialize(Path::new("/repo")).await.expect("init");
        assert_eq!(init, serde_json::json!({"ok": true}));
        // Concurrent requests share one pump and route by id.
        let (a, b) = tokio::join!(
            session.request("ping", serde_json::json!({})),
            session.request("ping", serde_json::json!({})),
        );
        assert_eq!(a.expect("a")["result"], serde_json::json!({"pong": true}));
        assert_eq!(b.expect("b")["result"], serde_json::json!({"pong": true}));
        // Diagnostics notification routed to the file store.
        assert!(session.diagnostics_for("file:///a.rs").is_some());
        session.shutdown().await.expect("shutdown");
        assert!(!session.is_alive());
    }

    #[test]
    fn pool_prunes_without_servers() {
        let pool = Pool::new();
        assert_eq!(pool.prune(), 0);
    }
}
