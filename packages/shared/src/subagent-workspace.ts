/**
 * Isolated subagent workspaces via detached git worktrees (ADR 0208).
 *
 * Parallel delegates editing the same root collide on writes, git state, and
 * builds. Policy: a mutating delegate gets `.pi/worktrees/task-<id>`; the
 * parent merges the reviewed diff back. Pure path/policy helpers — git
 * execution stays in Electron main / host.
 */

export const SUBAGENT_WORKTREE_ROOT = ".pi/worktrees";

/** Filesystem-safe task id for paths and branch names. */
export function sanitizeTaskId(taskId: string): string {
  const clean = taskId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return clean.replace(/^-+|-+$/g, "").slice(0, 48) || "task";
}

/** Detached worktree path for a delegate, e.g. `.pi/worktrees/task-a1b2`. */
export function subagentWorktreePath(taskId: string): string {
  return `${SUBAGENT_WORKTREE_ROOT}/task-${sanitizeTaskId(taskId)}`;
}

/** Branch name carrying the delegate's work for review. */
export function subagentWorktreeBranch(taskId: string): string {
  return `pi-task/${sanitizeTaskId(taskId)}`;
}

/** Ordered merge-back steps the parent follows after accepting the report. */
export function worktreeMergeSteps(taskId: string): readonly string[] {
  const path = subagentWorktreePath(taskId);
  const branch = subagentWorktreeBranch(taskId);
  return [
    `review diff in ${path}`,
    `stage accepted changes from ${branch}`,
    `merge ${branch} into the primary workspace`,
    `remove worktree ${path}`,
  ];
}
