/**
 * Thinking token allocation controls (ADR 0208; ADR 0144, ADR 0194).
 *
 * Exploratory delegates (grep/find triage) get 0–1,024 tokens. Large budgets
 * (8,192–16,384) are reserved for Plan mode and architectural synthesis.
 */

export const EXPLORATORY_THINKING_MAX = 1024;
export const PLAN_THINKING_MIN = 8192;
export const PLAN_THINKING_MAX = 16384;

export type ThinkingBudgetKind = "exploratory" | "standard" | "plan";

/** Recommended max thinking tokens for a delegate kind. */
export function thinkingBudget(kind: ThinkingBudgetKind): number {
  switch (kind) {
    case "exploratory":
      return EXPLORATORY_THINKING_MAX;
    case "plan":
      return PLAN_THINKING_MAX;
    default:
      return 4096;
  }
}

/** Clamp a requested budget into the allowed band for its kind. */
export function clampThinkingBudget(kind: ThinkingBudgetKind, requested: number): number {
  const want = Math.max(0, Math.floor(requested));
  if (kind === "exploratory") return Math.min(want, EXPLORATORY_THINKING_MAX);
  if (kind === "plan")
    return Math.max(PLAN_THINKING_MIN, Math.min(want, PLAN_THINKING_MAX));
  return Math.min(want, PLAN_THINKING_MAX);
}
