/**
 * Model routing + tiered cascading (ADR 0208).
 *
 * Frontier models implement; cheap models classify, title, summarize, and
 * sweep. Smaller-model fallback chain for background work:
 * already-set local model → user-chosen small provider model → current chat
 * model. Never invent a model; return undefined when the chain is empty.
 */

export const TIER1_CHEAP_TASKS = [
  "toolsearch-match",
  "session-title",
  "compaction-summary",
  "commit-message",
  "pr-summary",
  "triage-sweep",
] as const;
export type Tier1Task = (typeof TIER1_CHEAP_TASKS)[number];

export const TIER2_FRONTIER_TASKS = [
  "implement",
  "refactor",
  "debug",
  "plan",
  "synthesis",
] as const;
export type Tier2Task = (typeof TIER2_TASKS)[number];
const TIER2_TASKS = TIER2_FRONTIER_TASKS;

/** True for tasks that must default to a cheap model. */
export function isTier1Task(task: string): boolean {
  return (TIER1_CHEAP_TASKS as readonly string[]).includes(task);
}

export type SmallModelChoice = {
  /** Loopback model already configured (e.g. `ollama/qwen2.5-coder:7b`). */
  localModel?: string;
  /** Smaller provider model the user picked in settings. */
  userSmallModel?: string;
  /** Model of the current chat session. */
  currentModel: string;
};

/**
 * Resolve the model for cheap background work. Priority: local → user small →
 * current. Callers pass empties as undefined/""; whitespace never wins.
 */
export function resolveSmallModel(choice: SmallModelChoice): string | undefined {
  const local = choice.localModel?.trim();
  if (local) return local;
  const small = choice.userSmallModel?.trim();
  if (small) return small;
  const current = choice.currentModel?.trim();
  return current || undefined;
}
