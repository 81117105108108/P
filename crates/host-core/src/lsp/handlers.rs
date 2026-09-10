//! LSP method handlers: request builders for diagnostics, navigation,
//! hover, and rename. Pure JSON constructors — the supervisor sends them over
//! the framed transport in `client.rs` and routes responses back to RPC.

use serde_json::{json, Value};
use std::path::Path;

/// `file://` URI for a workspace path.
pub fn file_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    let text = path.to_string_lossy();
    #[cfg(windows)]
    {
        let escaped = text.replace('\\', "/");
        if escaped.starts_with('/') {
            uri.push_str(&escaped);
        } else {
            uri.push('/');
            uri.push_str(&escaped);
        }
    }
    #[cfg(not(windows))]
    {
        uri.push_str(&text);
    }
    uri
}

fn position(line: u32, col: u32) -> Value {
    json!({ "line": line, "character": col })
}

fn text_document(path: &Path) -> Value {
    json!({ "uri": file_uri(path) })
}

/// `initialize` handshake params for a workspace root.
pub fn initialize(root: &Path) -> Value {
    json!({
        "processId": std::process::id(),
        "rootUri": file_uri(root),
        "capabilities": {
            "textDocument": {
                "definition": { "dynamicRegistration": false },
                "references": { "dynamicRegistration": false },
                "hover": { "dynamicRegistration": false, "contentFormat": ["markdown", "plaintext"] },
                "rename": { "dynamicRegistration": false },
                "publishDiagnostics": { "relatedInformation": true },
            },
        },
    })
}

/// `textDocument/didOpen` notification params.
pub fn did_open(path: &Path, language_id: &str, text: &str) -> Value {
    json!({
        "textDocument": {
            "uri": file_uri(path),
            "languageId": language_id,
            "version": 1,
            "text": text,
        },
    })
}

/// `textDocument/definition` params (0-based line/col).
pub fn goto_definition(path: &Path, line: u32, col: u32) -> Value {
    json!({
        "textDocument": text_document(path),
        "position": position(line, col),
    })
}

/// `textDocument/references` params.
pub fn find_references(path: &Path, line: u32, col: u32) -> Value {
    json!({
        "textDocument": text_document(path),
        "position": position(line, col),
        "context": { "includeDeclaration": true },
    })
}

/// `textDocument/hover` params.
pub fn hover(path: &Path, line: u32, col: u32) -> Value {
    json!({
        "textDocument": text_document(path),
        "position": position(line, col),
    })
}

/// `textDocument/rename` params.
pub fn rename(path: &Path, line: u32, col: u32, new_name: &str) -> Value {
    json!({
        "textDocument": text_document(path),
        "position": position(line, col),
        "newName": new_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_positioned_requests() {
        let p = Path::new("/repo/a.rs");
        assert_eq!(goto_definition(p, 3, 7)["position"], json!({"line": 3, "character": 7}));
        assert_eq!(find_references(p, 0, 0)["context"]["includeDeclaration"], json!(true));
        assert_eq!(rename(p, 1, 2, "next")["newName"], json!("next"));
    }

    #[test]
    fn uris_are_file_scheme() {
        assert!(file_uri(Path::new("/repo/a.rs")).starts_with("file://"));
    }
}
