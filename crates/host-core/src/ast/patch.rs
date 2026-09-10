//! Content-hash anchored patching with fail-closed stale anchors.
//!
//! `HashEditRequest` carries the SHA256 of the block the agent saw. Exact
//! hash hit applies only when the entire nonempty block is unique. Moved
//! blocks still match; content drift requires a fresh read, never a fuzzy
//! first-line replacement. A syntax guard runs before writing.

use sha2::{Digest, Sha256};

/// One hash-anchored edit.
#[derive(Debug, Clone)]
pub struct HashEditRequest {
    /// File to edit (workspace-absolute by the time it reaches here).
    pub file_path: std::path::PathBuf,
    /// SHA256 hex of `expected_context` as the agent saw it.
    pub anchor_hash: String,
    /// Exact block the agent wants replaced.
    pub expected_context: String,
    /// Replacement text.
    pub replacement: String,
}

/// Outcome of [`apply_hash_edit`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchOutcome {
    /// Byte offset where the replacement landed.
    pub offset: usize,
    /// True when recovery (not the exact anchor) placed the edit.
    pub recovered: bool,
    /// Human-readable anchor label, e.g. `fn resolve_query`.
    pub anchor_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchError {
    /// The hash is invalid or the block is empty, absent, or ambiguous.
    AnchorNotFound,
    /// The edit would unbalance delimiters.
    SyntaxRejected { detail: String },
    /// Filesystem failure.
    Io(String),
}

impl std::fmt::Display for PatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PatchError::AnchorNotFound => write!(
                f,
                "AST_DIAGNOSTIC: expected a nonempty unique exact anchor with a valid hash; re-read the file"
            ),
            PatchError::SyntaxRejected { detail } => {
                write!(f, "AST_DIAGNOSTIC: edit rejected ({detail})")
            }
            PatchError::Io(e) => write!(f, "read/write failed: {e}"),
        }
    }
}

impl std::error::Error for PatchError {}

pub fn sha_hex(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    hex::encode(h.finalize())
}

/// First line trimmed to 80 chars — the anchor label shown to the agent.
fn label_of(block: &str) -> String {
    block
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(80)
        .collect()
}

/// Net delimiter balance for `()[]{}`, ignoring string/char/comment content
/// heuristically (counts quotes only outside `//` and `#` line comments).
fn balance_delta(text: &str) -> i64 {
    let mut bal: i64 = 0;
    let mut in_str: Option<char> = None;
    let mut escaped = false;
    for line in text.lines() {
        let code = line.split("//").next().unwrap_or(line);
        let code = if in_str.is_none() {
            code.split('#').next().unwrap_or(code)
        } else {
            code
        };
        for c in code.chars() {
            if escaped {
                escaped = false;
                continue;
            }
            if let Some(q) = in_str {
                if c == '\\' {
                    escaped = true;
                } else if c == q {
                    in_str = None;
                }
                continue;
            }
            match c {
                '"' | '\'' | '`' => in_str = Some(c),
                '(' | '[' | '{' => bal += 1,
                ')' | ']' | '}' => bal -= 1,
                _ => {}
            }
        }
    }
    bal
}

/// Apply `req` against `current` text. Pure: no filesystem access.
pub fn apply_hash_edit_text(
    current: &str,
    req: &HashEditRequest,
) -> Result<PatchOutcome, PatchError> {
    apply_hash_edit_text_with_lang(current, req, None)
}

/// Like [`apply_hash_edit_text`] with a Tree-sitter syntax verdict when `lang`
/// is known: the edited file must parse cleanly. Otherwise the heuristic
/// bracket-balance fallback applies; it is not a full syntax validator.
pub fn apply_hash_edit_text_with_lang(
    current: &str,
    req: &HashEditRequest,
    lang: Option<crate::ast::treesitter::TsLanguage>,
) -> Result<PatchOutcome, PatchError> {
    if req.expected_context.trim().is_empty() || sha_hex(&req.expected_context) != req.anchor_hash {
        return Err(PatchError::AnchorNotFound);
    }
    if let Some(offset) = current.find(&req.expected_context) {
        // rfind also catches overlapping occurrences (e.g. "aa" in "aaa").
        if current.rfind(&req.expected_context) != Some(offset) {
            return Err(PatchError::AnchorNotFound);
        }
        return splice(
            current,
            offset,
            &req.expected_context,
            &req.replacement,
            false,
            lang,
        );
    }
    Err(PatchError::AnchorNotFound)
}

fn splice(
    current: &str,
    offset: usize,
    needle: &str,
    replacement: &str,
    recovered: bool,
    lang: Option<crate::ast::treesitter::TsLanguage>,
) -> Result<PatchOutcome, PatchError> {
    let mut next = String::with_capacity(current.len() + replacement.len());
    next.push_str(&current[..offset]);
    next.push_str(replacement);
    next.push_str(&current[offset + needle.len()..]);
    if let Some(lang) = lang {
        ts_guard(current, &next, lang)?;
    } else if balance_delta(&next) != balance_delta(current) {
        return Err(PatchError::SyntaxRejected {
            detail: "delimiter balance changed; edit would break syntax".into(),
        });
    }
    Ok(PatchOutcome {
        offset,
        recovered,
        anchor_label: label_of(replacement),
    })
}

/// Require a clean result, including when the original file is broken.
/// Existing errors must not mask a syntax regression elsewhere.
fn ts_guard(
    _current: &str,
    next: &str,
    lang: crate::ast::treesitter::TsLanguage,
) -> Result<(), PatchError> {
    use crate::ast::treesitter as ts;
    let next_tree = ts::parse(lang, next).ok_or_else(|| PatchError::SyntaxRejected {
        detail: "could not parse edited file".into(),
    })?;
    if !ts::is_clean(&next_tree) {
        let line = ts::first_error_line(&next_tree, next).unwrap_or(0) + 1;
        return Err(PatchError::SyntaxRejected {
            detail: format!("edited file has syntax error at line {line}"),
        });
    }
    Ok(())
}

/// Load, apply, and write back. Returns the outcome plus new file hash.
pub fn apply_hash_edit_file(req: &HashEditRequest) -> Result<(PatchOutcome, String), PatchError> {
    use crate::ast::treesitter::TsLanguage;
    let current =
        std::fs::read_to_string(&req.file_path).map_err(|e| PatchError::Io(e.to_string()))?;
    let lang = TsLanguage::for_path(&req.file_path);
    let outcome = apply_hash_edit_text_with_lang(&current, req, lang)?;
    let mut next = String::with_capacity(current.len() + req.replacement.len());
    let needle = req.expected_context.as_str();
    let offset = outcome.offset;
    next.push_str(&current[..offset]);
    next.push_str(&req.replacement);
    next.push_str(&current[offset + needle.len()..]);
    std::fs::write(&req.file_path, &next).map_err(|e| PatchError::Io(e.to_string()))?;
    Ok((outcome, sha_hex(&next)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(context: &str, replacement: &str) -> HashEditRequest {
        HashEditRequest {
            file_path: std::path::PathBuf::from("x.rs"),
            anchor_hash: sha_hex(context),
            expected_context: context.into(),
            replacement: replacement.into(),
        }
    }

    #[test]
    fn clean_edit_applies_at_exact_anchor() {
        let current = "fn a() {\n    old();\n}\n";
        let r = req("    old();\n", "    new();\n");
        let out = apply_hash_edit_text(current, &r).expect("apply");
        assert!(!out.recovered);
        assert_eq!(out.offset, current.find("    old();\n").unwrap());
    }

    #[test]
    fn stale_anchor_fails_closed_inside_moved_item() {
        // Agent saw the item at offset 0; a header line landed above it and
        // trailing whitespace drifted the body, so the exact block is gone.
        let current = "// header added\nfn resolve_query() {\n    old();  \n}\n";
        let stale = HashEditRequest {
            file_path: std::path::PathBuf::from("x.rs"),
            anchor_hash: sha_hex("fn resolve_query() {\n    old();\n"),
            expected_context: "fn resolve_query() {\n    old();\n".into(),
            replacement: "fn resolve_query() {\n    new();\n".into(),
        };
        assert_eq!(
            apply_hash_edit_text(current, &stale),
            Err(PatchError::AnchorNotFound)
        );
    }

    #[test]
    fn unbalanced_edit_is_rejected() {
        let current = "fn a() {\n    ok();\n}\n";
        let r = req("    ok();\n", "    broken(();\n");
        assert!(matches!(
            apply_hash_edit_text(current, &r),
            Err(PatchError::SyntaxRejected { .. })
        ));
    }

    #[test]
    fn wrong_hash_never_applies() {
        let current = "fn a() {\n    old();\n}\n";
        let mut r = req("    old();\n", "    new();\n");
        r.anchor_hash = "0".repeat(64);
        assert_eq!(
            apply_hash_edit_text(current, &r),
            Err(PatchError::AnchorNotFound)
        );
    }

    #[test]
    fn tree_sitter_rejects_new_syntax_errors_with_line() {
        use crate::ast::treesitter::TsLanguage;
        let current = "fn a() {\n    ok();\n}\n";
        let r = req("    ok();\n", "    broken(();\n");
        let err = apply_hash_edit_text_with_lang(current, &r, Some(TsLanguage::Rust))
            .expect_err("must reject");
        assert!(matches!(err, PatchError::SyntaxRejected { .. }));
        assert!(err.to_string().contains("line"));
    }

    #[test]
    fn tree_sitter_does_not_recover_from_signature_alone() {
        use crate::ast::treesitter::TsLanguage;
        let current = "// header\nfn resolve_query() {\n    old();  \n}\n";
        let stale = HashEditRequest {
            file_path: std::path::PathBuf::from("x.rs"),
            anchor_hash: sha_hex("fn resolve_query() {\n    old();\n"),
            expected_context: "fn resolve_query() {\n    old();\n".into(),
            replacement: "fn resolve_query() {\n    new();\n".into(),
        };
        assert_eq!(
            apply_hash_edit_text_with_lang(current, &stale, Some(TsLanguage::Rust)),
            Err(PatchError::AnchorNotFound)
        );
    }

    #[test]
    fn file_edits_require_unique_whole_blocks_and_preserve_rejected_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("edit.rs");
        let current = "// moved\nfn a() {\n    old();\n}\nfn b() {}\n";
        std::fs::write(&path, current).unwrap();
        let mut r = req("fn a() {\n    old();\n}", "fn a() {\n    new();\n}");
        r.file_path = path.clone();
        let (out, hash) = apply_hash_edit_file(&r).unwrap();
        let expected = "// moved\nfn a() {\n    new();\n}\nfn b() {}\n";
        assert!(!out.recovered);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), expected);
        assert_eq!(hash, sha_hex(expected));

        for (text, context) in [
            (current, ""),
            (current, "  "),
            ("fn a() { old(); old(); }", "old();"),
            ("// aaa\nfn a() {}", "aa"),
            (current, "fn a() {\n old();\n}"),
            (
                "fn a() { changed(); }\nfn a() { changed(); }",
                "fn a() { old(); }",
            ),
        ] {
            std::fs::write(&path, text).unwrap();
            let mut r = req(context, "fn replacement() {}");
            r.file_path = path.clone();
            assert_eq!(apply_hash_edit_file(&r), Err(PatchError::AnchorNotFound));
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        }
    }

    #[test]
    fn syntax_guard_does_not_allow_existing_errors_to_mask_regressions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("edit.rs");
        for text in ["fn a() { old(); }", "fn broken( {}\nfn a() { old(); }"] {
            std::fs::write(&path, text).unwrap();
            let mut r = req("old();", "let = ;");
            r.file_path = path.clone();
            assert!(matches!(
                apply_hash_edit_file(&r),
                Err(PatchError::SyntaxRejected { .. })
            ));
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        }
        std::fs::write(&path, "fn broken( {}").unwrap();
        let mut r = req("fn broken( {}", "fn repaired() {}");
        r.file_path = path.clone();
        apply_hash_edit_file(&r).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "fn repaired() {}");
    }
}
