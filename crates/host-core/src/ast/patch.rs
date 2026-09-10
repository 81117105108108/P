//! Content-hash anchored patching with stale-anchor recovery.
//!
//! `HashEditRequest` carries the SHA256 of the block the agent saw. Exact
//! hash hit applies directly. On drift (line moves, whitespace), recovery
//! searches the enclosing `fn`/`class`/item signature and re-anchors when the
//! subtree shape still matches. A bracket-balance guard rejects edits that
//! would break syntax, returning an AST-diagnostic error instead.

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
    /// The block is gone and no enclosing item matches.
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
                "AST_DIAGNOSTIC: anchor block not found and no enclosing item matches; re-read the file"
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
    block.lines().next().unwrap_or("").trim().chars().take(80).collect()
}

/// Enclosing-item signature above `pos`: walks up for `fn|class|struct|enum|\
/// impl|trait|mod|def|function` beginnings and returns (line_idx, label).
fn enclosing_item(text: &str, pos: usize) -> Option<(usize, String)> {
    let upto = text.get(..pos.min(text.len())).unwrap_or("");
    let lines: Vec<&str> = upto.lines().collect();
    for (i, line) in lines.iter().enumerate().rev() {
        let t = line.trim_start();
        for kw in ["fn ", "class ", "struct ", "enum ", "impl ", "trait ", "mod ", "def ", "function "] {
            if t.starts_with(kw) {
                let label = t.chars().take(80).collect::<String>();
                return Some((i, label));
            }
        }
    }
    None
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
pub fn apply_hash_edit_text(current: &str, req: &HashEditRequest) -> Result<PatchOutcome, PatchError> {
    apply_hash_edit_text_with_lang(current, req, None)
}

/// Like [`apply_hash_edit_text`] with a Tree-sitter syntax verdict when `lang`
/// is known: an edit that introduces *new* parse errors is rejected with the
/// offending line; otherwise the bracket-balance fallback applies.
pub fn apply_hash_edit_text_with_lang(
    current: &str,
    req: &HashEditRequest,
    lang: Option<crate::ast::treesitter::TsLanguage>,
) -> Result<PatchOutcome, PatchError> {
    if sha_hex(&req.expected_context) != req.anchor_hash {
        return Err(PatchError::AnchorNotFound);
    }
    if let Some(offset) = current.find(&req.expected_context) {
        return splice(current, offset, &req.expected_context, &req.replacement, false, lang);
    }
    // Stale-anchor recovery: find the enclosing item of the expected block,
    // then the same signature in the current text, and re-anchor when the
    // item body still contains a unique fuzzy match of the block's first line.
    let first_line = req.expected_context.lines().next().unwrap_or("").trim();
    let sig = enclosing_item(&req.expected_context, req.expected_context.len())
        .map(|(_, l)| l)
        .unwrap_or_default();
    if !sig.is_empty() && !first_line.is_empty() {
        if let Some(item_pos) = current.find(sig.trim()) {
            let body = &current[item_pos..];
            let candidates: Vec<usize> = body
                .match_indices(first_line)
                .map(|(i, _)| item_pos + i)
                .collect();
            if candidates.len() == 1 {
                return splice(current, candidates[0], first_line, &req.replacement, true, lang);
            }
        }
    }
    // Grammar-scoped recovery: same signature via real definitions.
    if let Some(lang) = lang {
        if let Some((offset, needle_len)) = ts_recover(current, req, lang) {
            let needle = &current[offset..offset + needle_len];
            return splice(current, offset, needle, &req.replacement, true, Some(lang));
        }
    }
    Err(PatchError::AnchorNotFound)
}

/// Definition-scoped recovery with a real parse: locate the definition whose
/// label matches the expected block's signature, then require a unique
/// first-line hit inside that definition's byte range.
fn ts_recover(
    current: &str,
    req: &HashEditRequest,
    lang: crate::ast::treesitter::TsLanguage,
) -> Option<(usize, usize)> {
    use crate::ast::treesitter as ts;
    let tree = ts::parse(lang, current)?;
    let first_line = req.expected_context.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return None;
    }
    let sig = enclosing_item(&req.expected_context, req.expected_context.len())
        .map(|(_, l)| l)
        .unwrap_or_default();
    let sig_key = sig.split_whitespace().nth(1).unwrap_or("").trim_matches(|c| c == '(' || c == '{');
    if sig_key.is_empty() {
        return None;
    }
    let defs = ts::find_nodes(&tree, current, sig_key, 8);
    let def = defs.iter().find(|d| d.label.contains(sig_key))?;
    let start = line_offset(current, def.start_line)?;
    let end = line_offset(current, def.end_line.saturating_add(1)).unwrap_or(current.len());
    let body = current.get(start..end)?;
    let hits: Vec<usize> = body.match_indices(first_line).map(|(i, _)| start + i).collect();
    if hits.len() == 1 {
        Some((hits[0], first_line.len()))
    } else {
        None
    }
}

fn line_offset(text: &str, line: usize) -> Option<usize> {
    let mut at = 0usize;
    for (n, part) in text.split_inclusive('\n').enumerate() {
        if n == line {
            return Some(at);
        }
        at += part.len();
    }
    (line == text.lines().count()).then_some(text.len())
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

/// Tree-sitter verdict: reject only when the edit introduces *new* parse
/// errors. Editing an already-broken file is allowed (matches the bracket
/// fallback's leniency); breaking a clean file is not.
fn ts_guard(
    current: &str,
    next: &str,
    lang: crate::ast::treesitter::TsLanguage,
) -> Result<(), PatchError> {
    use crate::ast::treesitter as ts;
    let before_clean = ts::parse(lang, current).map(|t| ts::is_clean(&t)).unwrap_or(true);
    let next_tree = ts::parse(lang, next).ok_or_else(|| PatchError::SyntaxRejected {
        detail: "could not parse edited file".into(),
    })?;
    if !ts::is_clean(&next_tree) && before_clean {
        let line = ts::first_error_line(&next_tree, next).unwrap_or(0) + 1;
        return Err(PatchError::SyntaxRejected {
            detail: format!("edit introduces syntax error at line {line}"),
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
    // Recompute the splice against the file (same inputs => same offsets).
    let needle = if outcome.recovered {
        req.expected_context.lines().next().unwrap_or("").trim()
    } else {
        req.expected_context.as_str()
    };
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
    fn stale_anchor_recovers_inside_moved_item() {
        // Agent saw the item at offset 0; a header line landed above it and
        // trailing whitespace drifted the body, so the exact block is gone.
        let current = "// header added\nfn resolve_query() {\n    old();  \n}\n";
        let stale = HashEditRequest {
            file_path: std::path::PathBuf::from("x.rs"),
            anchor_hash: sha_hex("fn resolve_query() {\n    old();\n"),
            expected_context: "fn resolve_query() {\n    old();\n".into(),
            replacement: "fn resolve_query() {\n    new();\n".into(),
        };
        let out = apply_hash_edit_text(current, &stale).expect("recover");
        assert!(out.recovered);
        assert!(out.anchor_label.contains("fn resolve_query"));
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
    fn tree_sitter_recovers_through_real_definitions() {
        use crate::ast::treesitter::TsLanguage;
        let current = "// header\nfn resolve_query() {\n    old();  \n}\n";
        let stale = HashEditRequest {
            file_path: std::path::PathBuf::from("x.rs"),
            anchor_hash: sha_hex("fn resolve_query() {\n    old();\n"),
            expected_context: "fn resolve_query() {\n    old();\n".into(),
            replacement: "fn resolve_query() {\n    new();\n".into(),
        };
        let out = apply_hash_edit_text_with_lang(current, &stale, Some(TsLanguage::Rust))
            .expect("recover");
        assert!(out.recovered);
    }
}
