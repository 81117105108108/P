//! Stdio LSP transport: `Content-Length` framing over JSON-RPC.
//!
//! Pure encode/decode helpers shared by the supervisor and unit tests. The
//! async process pump lives in the manager follow-up; framing correctness is
//! what breaks servers most often, so it is pinned here.

use anyhow::{Context, Result};
use serde_json::Value;

/// Encode one JSON-RPC message with LSP headers.
pub fn encode_message(body: &Value) -> Vec<u8> {
    let text = serde_json::to_string(body).unwrap_or_else(|_| "{}".into());
    let mut out = format!("Content-Length: {}\r\n\r\n", text.len()).into_bytes();
    out.extend_from_slice(text.as_bytes());
    out
}

/// Split `buf` into (complete messages, leftover). Handles both `\r\n\r\n`
/// and bare `\n\n` separators; malformed length headers are skipped.
pub fn decode_buffer(buf: &[u8]) -> (Vec<Value>, Vec<u8>) {
    let mut messages = Vec::new();
    let mut rest = buf.to_vec();
    loop {
        let header_end = find_header_end(&rest);
        let Some((head_len, sep_len)) = header_end else {
            break;
        };
        let head = String::from_utf8_lossy(&rest[..head_len]).into_owned();
        let Some(len) = content_length(&head) else {
            rest = rest[head_len + sep_len..].to_vec();
            continue;
        };
        if rest.len() < head_len + sep_len + len {
            break;
        }
        let body = &rest[head_len + sep_len..head_len + sep_len + len];
        if let Ok(value) = serde_json::from_slice::<Value>(body) {
            messages.push(value);
        }
        rest = rest[head_len + sep_len + len..].to_vec();
    }
    (messages, rest)
}

fn find_header_end(buf: &[u8]) -> Option<(usize, usize)> {
    buf.windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| (i, 4))
        .or_else(|| buf.windows(2).position(|w| w == b"\n\n").map(|i| (i, 2)))
}

/// Parse `Content-Length` from a header block.
pub fn content_length(head: &str) -> Option<usize> {
    head.lines().find_map(|line| {
        let (k, v) = line.split_once(':')?;
        if k.trim().eq_ignore_ascii_case("content-length") {
            v.trim().parse::<usize>().ok()
        } else {
            None
        }
    })
}

/// Build a JSON-RPC request object.
pub fn request(id: i64, method: &str, params: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
}

/// Build a JSON-RPC notification (no id).
pub fn notification(method: &str, params: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
}

/// Read one framed message from an async reader with a byte cap.
pub async fn read_message<R>(reader: &mut R, max_bytes: usize) -> Result<Value>
where
    R: tokio::io::AsyncReadExt + Unpin,
{
    use tokio::io::AsyncBufReadExt;
    let mut reader = tokio::io::BufReader::new(reader);
    let mut head = Vec::new();
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .context("lsp header read failed")?;
        if line.trim().is_empty() {
            break;
        }
        head.push(line);
        if head.join("").len() > 64 * 1024 {
            anyhow::bail!("lsp header too large");
        }
    }
    let joined = head.join("");
    let len = content_length(&joined).context("lsp message without Content-Length")?;
    if len > max_bytes {
        anyhow::bail!("lsp message exceeds {max_bytes} bytes");
    }
    let mut body = vec![0u8; len];
    tokio::io::AsyncReadExt::read_exact(&mut reader, &mut body)
        .await
        .context("lsp body read failed")?;
    serde_json::from_slice(&body).context("lsp body is not JSON")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_one_message() {
        let body = serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "ping"});
        let framed = encode_message(&body);
        let (msgs, rest) = decode_buffer(&framed);
        assert_eq!(msgs, vec![body]);
        assert!(rest.is_empty());
    }

    #[test]
    fn splits_concatenated_messages_and_keeps_partial() {
        let a = encode_message(&serde_json::json!({"id": 1}));
        let b = encode_message(&serde_json::json!({"id": 2}));
        let mut both = a.clone();
        both.extend_from_slice(&b);
        both.extend_from_slice(&a[..a.len() / 2]);
        let (msgs, rest) = decode_buffer(&both);
        assert_eq!(msgs.len(), 2);
        assert_eq!(rest, a[..a.len() / 2]);
    }

    #[test]
    fn parses_length_case_insensitively() {
        assert_eq!(content_length("content-length: 42"), Some(42));
        assert_eq!(content_length("Content-Length: 7\r"), Some(7));
        assert_eq!(content_length("X-Other: 1"), None);
    }
}
