import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skillTest, triggerScore } from "./skill-test.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-skill-test-"));
  const skill = join(dir, "review.md");
  writeFileSync(
    skill,
    "---\nname: Reviewer\n" +
      "description: Second opinion on diff correctness and edge cases.\n" +
      "---\n\nReview each finding as path:line with severity ordering.\n",
  );
  const goldens = join(dir, "goldens.json");
  writeFileSync(
    goldens,
    JSON.stringify([
      {
        question: "Give me a second opinion on this diff for correctness",
        mustContain: ["severity"],
      },
    ]),
  );
  return { skill, goldens };
}

describe("triggerScore", () => {
  it("scores overlap and ignores empty questions", () => {
    expect(triggerScore("second opinion on diff", "second opinion diff reviewer")).toBe(1);
    expect(triggerScore("", "anything")).toBe(0);
    expect(triggerScore("lunch plans", "second opinion diff")).toBe(0);
  });
});

describe("skillTest", () => {
  it("passes applicable skills that teach the phrases", async () => {
    const { skill, goldens } = fixture();
    const report = await skillTest({ skillPath: skill, goldensPath: goldens });
    expect(report.ok).toBe(true);
    expect(report.goldens).toHaveLength(1);
  });

  it("fails regressions that drop taught phrases", async () => {
    const { skill, goldens } = fixture();
    const report = await skillTest({ skillPath: skill, goldensPath: goldens });
    expect(report.ok).toBe(true);
    const bad = await skillTest({
      skillPath: skill,
      goldensPath: goldens,
      threshold: 0.99,
    });
    expect(bad.ok).toBe(false);
  });
});
