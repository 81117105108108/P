//! Universal rule ingestion (ADR 0209).
//!
//! Walks from the workspace root upward, collecting `.cursorrules`,
//! `.clinerules`, `AGENTS.md`, and `CLAUDE.md` plus `<root>/.pi/rules/*.md`.
//! Output concatenates highest-precedence (nearest) first with source headers,
//! so prompt assembly can treat it as the semi-static block.

pub mod discovery;
