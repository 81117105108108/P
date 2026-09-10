import { readFile } from "node:fs/promises";
import { parseSkillFrontmatter } from "@pi-desktop/plugin-sdk";

export type SkillGoldenInput = {
  question: string;
  mustContain: string[];
};

export type SkillGoldenVerdict = {
  question: string;
  trigger: number;
  missing: string[];
  pass: boolean;
};

export type SkillTestReport = {
  skillId: string;
  name: string;
  goldens: SkillGoldenVerdict[];
  ok: boolean;
};

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length > 2),
  );
}

/** Fraction of question words present in the skill text. */
export function triggerScore(question: string, skillText: string): number {
  const q = words(question);
  if (!q.size) return 0;
  const s = words(skillText);
  let hit = 0;
  for (const w of q) if (s.has(w)) hit++;
  return hit / q.size;
}

/**
 * Static skill evaluation: for each golden question, the skill must look
 * applicable (trigger overlap) and must teach every required phrase. Run
 * after prompt tweaks to catch regressions before shipping the plugin.
 */
export async function skillTest(input: {
  skillPath: string;
  goldensPath: string;
  threshold?: number;
}): Promise<SkillTestReport> {
  const threshold = input.threshold ?? 0.5;
  const raw = await readFile(input.skillPath, "utf8");
  const parsed = parseSkillFrontmatter(raw);
  if (!parsed.body) {
    throw new Error(`skill has no body: ${input.skillPath}`);
  }
  const goldensRaw = await readFile(input.goldensPath, "utf8");
  const goldens = JSON.parse(goldensRaw) as SkillGoldenInput[];
  if (!Array.isArray(goldens)) throw new Error(`goldens file must be an array: ${input.goldensPath}`);
  const skillText = `${parsed.name ?? ""} ${parsed.description ?? ""} ${parsed.body}`;
  const bodyLower = parsed.body.toLowerCase();
  const verdicts = goldens.map((golden) => {
    const trigger = triggerScore(golden.question, skillText);
    const missing = (golden.mustContain ?? []).filter(
      (phrase) => !bodyLower.includes(String(phrase).toLowerCase()),
    );
    return {
      question: golden.question,
      trigger,
      missing,
      pass: trigger >= threshold && missing.length === 0,
    };
  });
  return {
    skillId: input.skillPath,
    name: parsed.name ?? input.skillPath,
    goldens: verdicts,
    ok: verdicts.length > 0 && verdicts.every((v) => v.pass),
  };
}
