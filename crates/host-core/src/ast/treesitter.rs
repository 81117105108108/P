//! Tree-sitter grammar backend (ADR 0210).
//!
//! Real parsing for Rust, TypeScript/TSX, Python, and Go behind the same
//! `HashEditRequest` API: syntax-error verdicts, enclosing-definition lookup
//! for stale-anchor recovery, and node-kind-annotated structural search.
//! Files without a grammar fall back to the dependency-free line layer.

use std::path::Path;
use tree_sitter::{Language, Node, Parser, Tree};

/// Grammar key for a path extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TsLanguage {
    Rust,
    TypeScript,
    Python,
    Go,
}

impl TsLanguage {
    pub fn for_path(path: &Path) -> Option<Self> {
        match path.extension().and_then(|e| e.to_str()) {
            Some("rs") => Some(TsLanguage::Rust),
            Some("ts") | Some("tsx") | Some("js") | Some("jsx") | Some("mts") => {
                Some(TsLanguage::TypeScript)
            }
            Some("py") => Some(TsLanguage::Python),
            Some("go") => Some(TsLanguage::Go),
            _ => None,
        }
    }

    fn language(self) -> Language {
        match self {
            TsLanguage::Rust => tree_sitter_rust::language(),
            TsLanguage::TypeScript => tree_sitter_typescript::language_typescript(),
            TsLanguage::Python => tree_sitter_python::language(),
            TsLanguage::Go => tree_sitter_go::language(),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            TsLanguage::Rust => "rust",
            TsLanguage::TypeScript => "typescript",
            TsLanguage::Python => "python",
            TsLanguage::Go => "go",
        }
    }
}

/// Parse `text` with the grammar for `lang`. Returns `None` on internal error.
pub fn parse(lang: TsLanguage, text: &str) -> Option<Tree> {
    let mut parser = Parser::new();
    parser.set_language(&lang.language()).ok()?;
    parser.parse(text, None)
}

/// True when the tree contains no ERROR/MISSING nodes.
pub fn is_clean(tree: &Tree) -> bool {
    !tree.root_node().has_error()
}

/// First 0-based line of an ERROR node, if any.
pub fn first_error_line(tree: &Tree, text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if node.is_error() || node.is_missing() {
            return Some(node.start_position().row);
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.has_error() || child.is_error() || child.is_missing() {
                stack.push(child);
            }
        }
        let _ = bytes;
    }
    None
}

/// Definition-item node kinds per grammar.
fn def_kinds(lang: TsLanguage) -> &'static [&'static str] {
    match lang {
        TsLanguage::Rust => &["function_item", "impl_item", "struct_item", "enum_item", "trait_item", "mod_item"],
        TsLanguage::TypeScript => &[
            "function_declaration",
            "method_definition",
            "class_declaration",
            "interface_declaration",
            "lexical_declaration",
        ],
        TsLanguage::Python => &["function_definition", "class_definition"],
        TsLanguage::Go => &["function_declaration", "method_declaration", "type_declaration"],
    }
}

/// Innermost definition node enclosing byte `offset`, with its label.
pub fn enclosing_def<'a>(
    lang: TsLanguage,
    tree: &'a Tree,
    text: &'a str,
    offset: usize,
) -> Option<(Node<'a>, String)> {
    let kinds = def_kinds(lang);
    let mut node = tree
        .root_node()
        .descendant_for_byte_range(offset.min(text.len()), offset.min(text.len()))?;
    loop {
        if kinds.contains(&node.kind()) {
            let label = node_label(node, text);
            return Some((node, label));
        }
        node = node.parent()?;
    }
}

/// One-line label: `kind` + first line of the node, trimmed to 80 chars.
pub fn node_label(node: Node<'_>, text: &str) -> String {
    let snippet = node.utf8_text(text.as_bytes()).unwrap_or("");
    let first = snippet.lines().next().unwrap_or("").trim();
    format!("{} {}", node.kind(), first)
        .chars()
        .take(96)
        .collect()
}

/// Named-node hits whose kind or text contains `needle` (case-insensitive),
/// capped at `limit`. Used to annotate structural search with node kinds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TsHit {
    pub kind: String,
    pub start_line: usize,
    pub end_line: usize,
    pub label: String,
}

pub fn find_nodes(tree: &Tree, text: &str, needle: &str, limit: usize) -> Vec<TsHit> {
    let needle = needle.to_lowercase();
    let mut hits = Vec::new();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if hits.len() >= limit {
            break;
        }
        if node.is_named() {
            let label = node_label(node, text);
            if label.to_lowercase().contains(&needle) {
                hits.push(TsHit {
                    kind: node.kind().to_string(),
                    start_line: node.start_position().row,
                    end_line: node.end_position().row,
                    label,
                });
            }
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            stack.push(child);
        }
    }
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rust_and_reports_clean() {
        let tree = parse(TsLanguage::Rust, "fn a() {\n    ok();\n}\n").expect("parse");
        assert!(is_clean(&tree));
        assert_eq!(first_error_line(&tree, "fn a() {}"), None);
    }

    #[test]
    fn flags_syntax_errors_with_line() {
        let text = "fn a() {\n    broken(();\n}\n";
        let tree = parse(TsLanguage::Rust, text).expect("parse");
        assert!(!is_clean(&tree));
        assert_eq!(first_error_line(&tree, text), Some(1));
    }

    #[test]
    fn finds_enclosing_def() {
        let text = "fn resolve_query() {\n    old();\n}\n";
        let tree = parse(TsLanguage::Rust, text).expect("parse");
        let offset = text.find("old").unwrap();
        let (node, label) = enclosing_def(TsLanguage::Rust, &tree, text, offset).expect("def");
        assert_eq!(node.kind(), "function_item");
        assert!(label.contains("resolve_query"));
    }

    #[test]
    fn finds_nodes_by_name() {
        let text = "fn alpha() {}\nfn beta() {}\n";
        let tree = parse(TsLanguage::Rust, text).expect("parse");
        let hits = find_nodes(&tree, text, "beta", 10);
        let defs: Vec<_> = hits.iter().filter(|h| h.kind == "function_item").collect();
        assert_eq!(defs.len(), 1);
        assert!(defs[0].label.contains("beta"));
    }

    #[test]
    fn maps_extensions() {
        assert_eq!(
            TsLanguage::for_path(Path::new("a.tsx")),
            Some(TsLanguage::TypeScript)
        );
        assert_eq!(TsLanguage::for_path(Path::new("a.md")), None);
    }
}
