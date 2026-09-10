/**
 * Best-of-N speculative execution across isolated worktrees (ADR 0209).
 *
 * The parent fans one task out to N delegates (each in its own
 * `.pi/worktrees/task-<id>`), scores the joined reports deterministically,
 * and merges only the winner. Pure planning/scoring — spawning stays in the
 * `Task` tool, merging in `IsoDiff` review.
 */

export type SpeculativeBid = {
  delegationId: string;
  taskId: string;
  /** Files the delegate claims to have changed. */
  filesChanged: string[];
  /** Delegate-reported test outcome. */
  testsPassed: boolean;
  /** Insertions+deletions from IsoDiff, when available. */
  churn?: number;
};

export type SpeculativePlan = {
  prompt: string;
  /** One worktree task id per bid. */
  taskIds: string[];
  /** Max parallel delegates (bounded by MAX_SUBAGENT_CONCURRENCY). */
  width: number;
};

/** Build a fan-out plan for N variants of one prompt. */
export function planSpeculative(prompt: string, taskIds: string[], width = 3): SpeculativePlan {
  return {
    prompt,
    taskIds: taskIds.slice(0, Math.max(1, Math.min(width, 10))),
    width: Math.max(1, Math.min(width, 10)),
  };
}

/**
 * Pick the winner: passing tests first, then smallest churn, then first bid.
 * Returns undefined for an empty field.
 */
export function pickWinner(bids: readonly SpeculativeBid[]): SpeculativeBid | undefined {
  if (!bids.length) return undefined;
  return [...bids].sort((a, b) => {
    if (a.testsPassed !== b.testsPassed) return a.testsPassed ? -1 : 1;
    const churnA = a.churn ?? Number.MAX_SAFE_INTEGER;
    const churnB = b.churn ?? Number.MAX_SAFE_INTEGER;
    if (churnA !== churnB) return churnA - churnB;
    return 0;
  })[0];
}

/** Loser task ids to discard after the winner merges. */
export function losers(bids: readonly SpeculativeBid[], winner: SpeculativeBid): string[] {
  return bids.filter((b) => b.delegationId !== winner.delegationId).map((b) => b.taskId);
}
