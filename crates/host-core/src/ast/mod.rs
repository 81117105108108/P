//! Structural AST engine: `$VAR` pattern search and hash-anchored patching.
//!
//! Dependency-free structural layer (ADR 0209): line-oriented matching with
//! identifier-wildcard `$NAME` slots plus indent-aware anchor recovery and a
//! bracket-balance syntax guard. Tree-sitter grammars slot behind the same
//! `HashEditRequest` API as a follow-up without changing callers.

pub mod grep;
pub mod patch;
