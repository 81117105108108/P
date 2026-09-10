//! Git worktree fallback and snapshot diff summaries.
//!
//! Used when the workspace is a git checkout and reflink isolation is
//! unavailable or when the caller explicitly wants branch-backed isolation.
//! `diff_summary` parses `git diff --numstat` so reviewers get file counts
//! without materializing full diffs.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Unified diff totals for a snapshot.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DiffSummary {
    pub files_changed: usize,
    pub insertions: usize,
    pub deletions: usize,
}

/// `git worktree add --detach <dest> HEAD` in `repo`.
pub fn worktree_add(repo: &Path, dest: &Path) -> Result<()> {
    let status = Command::new("git")
        .args(["worktree", "add", "--detach"])
        .arg(dest)
        .arg("HEAD")
        .current_dir(repo)
        .status()
        .context("git worktree add")?;
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("git worktree add failed: {status}")
    }
}

/// `git worktree remove --force <dest>` (best effort: also prunes).
pub fn worktree_remove(repo: &Path, dest: &Path) -> Result<()> {
    let status = Command::new("git")
        .args(["worktree", "remove", "--force"])
        .arg(dest)
        .current_dir(repo)
        .status()
        .context("git worktree remove")?;
    let _ = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(repo)
        .status();
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("git worktree remove failed: {status}")
    }
}

/// Parse `git diff --numstat` output into totals.
pub fn parse_numstat(output: &str) -> DiffSummary {
    let mut summary = DiffSummary::default();
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let (Some(ins), Some(del)) = (parts.next(), parts.next()) else {
            continue;
        };
        // Binary files report `- - path`; count the file, skip line math.
        summary.files_changed += 1;
        summary.insertions += ins.parse::<usize>().unwrap_or(0);
        summary.deletions += del.parse::<usize>().unwrap_or(0);
    }
    summary
}

/// Uncommitted diff of `repo` (worktree or primary) as totals.
pub fn diff_summary(repo: &Path) -> Result<DiffSummary> {
    let out = Command::new("git")
        .args(["diff", "--numstat", "--", "."])
        .current_dir(repo)
        .output()
        .context("git diff --numstat")?;
    if !out.status.success() {
        anyhow::bail!("git diff failed: {}", out.status);
    }
    Ok(parse_numstat(&String::from_utf8_lossy(&out.stdout)))
}

/// Absolute snapshot dir for a task (same policy as `cow::snapshot_path`).
pub fn task_snapshot_dir(root: &Path, task_id: &str) -> PathBuf {
    super::cow::snapshot_path(root, task_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_numstat_with_binary_rows() {
        let s = parse_numstat("10\t2\tsrc/a.rs\n-\t-\timg.png\n");
        assert_eq!(
            s,
            DiffSummary {
                files_changed: 2,
                insertions: 10,
                deletions: 2,
            }
        );
    }

    #[test]
    fn empty_diff_is_zero() {
        assert_eq!(parse_numstat(""), DiffSummary::default());
    }
}
