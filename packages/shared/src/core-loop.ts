/**
 * Solid core loop: peak quality at lowest tokens, latency, and inference cost
 * (ADR 0207).
 *
 * - One active destination, one model turn at a time.
 * - Deferred tools + Skill/MCP routers: catalogs in prompt, bodies on demand.
 * - Local-model delegates for sweeps; cloud model for judgments.
 * - Bounded windows: transcript pages, panes, delegations, retries.
 */

export const CORE_LOOP_BUDGETS = {
  /** Semble hits before falling back to sg/rg. */
  sembleTopK: 5,
  /** Max mounted transcript rows per pane. */
  transcriptWindow: 200,
  /** Max retained session panes (visible + 2 recent). */
  retainedPanes: 3,
  /** Max retained delegations per session. */
  retainedDelegations: 100,
  /** Provider auto-retries with progress status. */
  providerRetries: 10,
  /** Permission card timeout → deny. */
  permissionTimeoutSeconds: 120,
} as const;

/** Skill router: catalog up front, body only via Skill tool. */
export const SKILL_ROUTER_RULES: readonly string[] = [
  "prompt carries id/name/description only",
  "Skill(id) loads body at most once per task",
  "builtin skills ride the same path as plugin skills",
  "user skills win name clashes",
];

/** When to delegate vs do inline: delegates earn their spawn cost. */
export const DELEGATION_POLICY: readonly string[] = [
  "sweep over many files → explorer (local model OK)",
  "second opinion on diff → code-reviewer",
  "long command output → test-runner",
  "multi-file change from spec → fixer",
  "single-file lookup → inline Read/Grep, no delegate",
];

export function coreLoopSummary(): string {
  return [
    `semble top-k ${CORE_LOOP_BUDGETS.sembleTopK}`,
    `transcript window ${CORE_LOOP_BUDGETS.transcriptWindow}`,
    `panes ${CORE_LOOP_BUDGETS.retainedPanes}`,
    `delegations ${CORE_LOOP_BUDGETS.retainedDelegations}`,
    `retries ${CORE_LOOP_BUDGETS.providerRetries}`,
  ].join("; ");
}
