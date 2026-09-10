/**
 * Skills: progressive disclosure + executable playbooks (ADR 0208).
 *
 * Stage 1 (this slice): trigger evaluation. Skills ship as id/triggers/path
 * metadata; turn preflight scores the user prompt and injects only matches
 * above threshold into the prompt suffix — never the whole library.
 * Stage 2 shapes (playbook, harness) are typed here so plugins can adopt them
 * without a second schema migration.
 */

/** Inject when similarity meets or exceeds this. */
export const SKILL_TRIGGER_THRESHOLD = 0.82;

export type SkillTrigger = {
  id: string;
  triggers: readonly string[];
  contentPath: string;
};

export type SkillPlaybookStep =
  | { kind: "assert"; check: string }
  | { kind: "execute"; run: string }
  | { kind: "verify"; expect: string }
  | { kind: "fallback"; run: string; when: string };

export type SkillPlaybook = {
  skillId: string;
  steps: readonly SkillPlaybookStep[];
};

export type SkillGolden = {
  skillId: string;
  question: string;
  mustContain: readonly string[];
};

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length > 2),
  );
}

/**
 * Keyword-overlap similarity in [0,1]: |prompt ∩ triggers| / |prompt|.
 * Cheap preflight gate; embedding rerank may replace it later.
 */
export function skillSimilarity(prompt: string, trigger: SkillTrigger): number {
  const p = words(prompt);
  if (!p.size) return 0;
  const t = new Set(trigger.triggers.flatMap((s) => [...words(s)]));
  let hit = 0;
  for (const w of p) if (t.has(w)) hit++;
  return hit / p.size;
}

/** Triggers worth injecting, ordered best-first. */
export function matchingSkills(
  prompt: string,
  triggers: readonly SkillTrigger[],
  threshold: number = SKILL_TRIGGER_THRESHOLD,
): SkillTrigger[] {
  return triggers
    .map((t) => ({ t, score: skillSimilarity(prompt, t) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.t);
}
