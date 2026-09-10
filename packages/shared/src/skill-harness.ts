/**
 * Skill evaluation harness, stage 2 (ADR 0210): executable playbooks and
 * golden checks shared by the `pi-plugin skill-test` CLI and future runners.
 *
 * Playbooks are deterministic: asserts gate, executes produce output,
 * verifies accept it, and one matching fallback fires per failure. Goldens
 * score reference answers without a model call — the CLI checks trigger
 * applicability statically; CI checks recorded outputs here.
 */

import type { SkillGolden, SkillPlaybook, SkillPlaybookStep } from "./skill-triggers.js";

export type PlaybookHandlers = {
  assert: (check: string) => Promise<boolean> | boolean;
  execute: (run: string) => Promise<string> | string;
  verify: (expect: string, output: string) => Promise<boolean> | boolean;
};

export type PlaybookStepReport = {
  step: SkillPlaybookStep;
  ok: boolean;
  detail?: string;
};

export type PlaybookReport = {
  skillId: string;
  steps: PlaybookStepReport[];
  ok: boolean;
};

/** Run a playbook front to back. Pure orchestration; I/O lives in handlers. */
export async function runPlaybook(
  playbook: SkillPlaybook,
  handlers: PlaybookHandlers,
): Promise<PlaybookReport> {
  const steps: PlaybookStepReport[] = [];
  let lastOutput = "";
  let ok = true;
  for (const step of playbook.steps) {
    if (step.kind === "assert") {
      const passed = await handlers.assert(step.check);
      steps.push({ step, ok: passed, detail: passed ? undefined : `assert failed: ${step.check}` });
      if (!passed) {
        ok = false;
        break;
      }
    } else if (step.kind === "execute") {
      lastOutput = await handlers.execute(step.run);
      steps.push({ step, ok: true });
    } else if (step.kind === "verify") {
      const passed = await handlers.verify(step.expect, lastOutput);
      if (passed) {
        steps.push({ step, ok: true });
        continue;
      }
      // One matching fallback, then re-verify once.
      const fallback = playbook.steps.find(
        (s): s is Extract<SkillPlaybookStep, { kind: "fallback" }> =>
          s.kind === "fallback" && step.expect.toLowerCase().includes(s.when.toLowerCase()),
      );
      if (!fallback) {
        steps.push({ step, ok: false, detail: `verify failed: ${step.expect}` });
        ok = false;
        break;
      }
      lastOutput = await handlers.execute(fallback.run);
      steps.push({ step: fallback, ok: true });
      const retried = await handlers.verify(step.expect, lastOutput);
      steps.push({ step, ok: retried, detail: retried ? undefined : `verify failed: ${step.expect}` });
      if (!retried) {
        ok = false;
        break;
      }
    } else {
      // Bare fallbacks only fire through a verify above; reaching one
      // directly is a no-op success.
      steps.push({ step, ok: true });
    }
  }
  return { skillId: playbook.skillId, steps, ok };
}

export type GoldenReport = {
  skillId: string;
  question: string;
  pass: boolean;
  missing: string[];
};

/**
 * Score recorded answers against goldens: every `mustContain` phrase must
 * appear (case-insensitive). No model call — CI replays real delegate
 * outputs through this after `runPlaybook` executions.
 */
export function evaluateGoldens(
  goldens: readonly SkillGolden[],
  answerFor: (question: string) => string,
): GoldenReport[] {
  return goldens.map((golden) => {
    const answer = answerFor(golden.question).toLowerCase();
    const missing = golden.mustContain.filter((phrase) => !answer.includes(phrase.toLowerCase()));
    return { skillId: golden.skillId, question: golden.question, pass: missing.length === 0, missing };
  });
}
