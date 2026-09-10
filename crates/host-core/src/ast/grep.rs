//! Structural node search: `$PATTERN` matching over file lines.
//!
//! Uppercase `$NAME` slots match one identifier-ish token (`[A-Za-z0-9_.:]+`);
//! every other token must match literally after trimming. Returns
//! `path:line` hits with the source snippet — the same shape `Grep` returns,
//! so routers and the UI need no new rendering path.

use std::path::Path;

/// One structural hit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AstHit {
    /// 0-based line number.
    pub line: usize,
    /// Source line text.
    pub snippet: String,
    /// `$NAME -> matched token` bindings for this hit.
    pub bindings: Vec<(String, String)>,
}

fn is_slot(token: &str) -> bool {
    token.starts_with('$')
        && token.len() > 1
        && token[1..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_ident_token(token: &str) -> bool {
    !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == ':')
}

/// Compile one pattern token to a regex, turning embedded `$NAME` slots into
/// identifier capture groups. Returns the regex plus slot names in order.
fn token_regex(token: &str) -> Option<(regex::Regex, Vec<String>)> {
    let mut re = String::from("^");
    let mut slots = Vec::new();
    let mut chars = token.chars().peekable();
    let mut literal = String::new();
    while let Some(c) = chars.next() {
        if c == '$' {
            let mut name = String::from("$");
            while let Some(&n) = chars.peek() {
                if n.is_ascii_alphanumeric() || n == '_' {
                    name.push(n);
                    chars.next();
                } else {
                    break;
                }
            }
            if name.len() < 2 {
                return None;
            }
            re.push_str(&regex::escape(&literal));
            literal.clear();
            re.push_str("([A-Za-z0-9_.:]+)");
            slots.push(name);
        } else {
            literal.push(c);
        }
    }
    re.push_str(&regex::escape(&literal));
    re.push('$');
    Some((regex::Regex::new(&re).ok()?, slots))
}

/// Split into tokens on whitespace and punctuation boundaries so
/// `fn old() {` becomes `[fn, old, (, ), {]` and patterns may write
/// `fn $NAME ( ) {` naturally.
fn split_tokens(s: &str) -> Vec<String> {
    let mut toks = Vec::new();
    let mut cur = String::new();
    for c in s.chars() {
        if c.is_whitespace() {
            if !cur.is_empty() {
                toks.push(std::mem::take(&mut cur));
            }
        } else if "(){}[],;".contains(c) {
            if !cur.is_empty() {
                toks.push(std::mem::take(&mut cur));
            }
            toks.push(c.to_string());
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        toks.push(cur);
    }
    toks
}

/// Match one pattern line against one source line.
fn match_line(pattern: &str, source: &str) -> Option<Vec<(String, String)>> {
    let pats = split_tokens(pattern);
    let toks = split_tokens(source);
    if pats.len() != toks.len() {
        return None;
    }
    let mut bindings = Vec::new();
    for (pat, tok) in pats.iter().zip(toks.iter()) {
        if is_slot(pat) {
            if !is_ident_token(tok) {
                return None;
            }
            bindings.push((pat.to_string(), tok.to_string()));
            continue;
        }
        if !pat.contains('$') {
            if pat != tok {
                return None;
            }
            continue;
        }
        let (re, slots) = token_regex(pat)?;
        let caps = re.captures(tok)?;
        for (i, name) in slots.iter().enumerate() {
            bindings.push((name.clone(), caps[i + 1].to_string()));
        }
    }
    Some(bindings)
}

/// Search `text` for `pattern` (single line). `path` is carried by the caller.
pub fn ast_grep_text(_path: &Path, text: &str, pattern: &str) -> Vec<AstHit> {
    text.lines()
        .enumerate()
        .filter_map(|(line, src)| {
            match_line(pattern, src).map(|bindings| AstHit {
                line,
                snippet: src.to_string(),
                bindings,
            })
        })
        .collect()
}

/// Search a file on disk.
pub fn ast_grep_file(path: &Path, pattern: &str) -> anyhow::Result<Vec<AstHit>> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("ast_grep read failed: {e}"))?;
    Ok(ast_grep_text(path, &text, pattern))
}

/// Which engine backs search for this path: real grammar or text fallback.
pub fn engine_for(path: &Path) -> &'static str {
    match crate::ast::treesitter::TsLanguage::for_path(path) {
        Some(_) => "tree-sitter",
        None => "text",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_matches_identifiers_positionally() {
        let hits = ast_grep_text(
            Path::new("a.rs"),
            "foo(bar)\nfoo(1 + 2)\n",
            "foo($ARG)",
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 0);
        assert_eq!(hits[0].bindings, vec![("$ARG".to_string(), "bar".to_string())]);
    }

    #[test]
    fn literal_tokens_must_match() {
        let hits = ast_grep_text(Path::new("a.ts"), "let x = 1\nconst x = 1\n", "let $N = 1");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].snippet, "let x = 1");
    }
}
