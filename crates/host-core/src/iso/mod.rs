//! Copy-on-Write workspace isolation (ADR 0209).
//!
//! `cow` attempts zero-byte clones (APFS `cp -c` on macOS,
//! `cp --reflink=auto` on Linux); `worktree` is the git fallback. Snapshots
//! live under `.pi/worktrees/task-<id>`, matching the shared
//! `subagent-workspace` policy so Rust and TypeScript agree on paths.

pub mod cow;
pub mod worktree;
