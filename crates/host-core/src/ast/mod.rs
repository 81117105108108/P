//! Structural AST engine: `$VAR` pattern search and hash-anchored patching.
//!
//! Two layers behind one API (ADR 0209/0210): a dependency-free line matcher
//! plus real Tree-sitter grammars (Rust, TypeScript, Python, Go) for syntax
//! verdicts, definition-anchored recovery, and node-annotated search.

pub mod grep;
pub mod patch;
pub mod treesitter;
