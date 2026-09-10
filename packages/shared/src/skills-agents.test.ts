import { describe, expect, it } from "vitest";
import { SKILL_TRIGGER_THRESHOLD, matchingSkills } from "./skill-triggers.js";
import { needsVerification, verificationTurn } from "./agent-verification.js";
import { subagentWorktreeBranch, subagentWorktreePath, worktreeMergeSteps } from "./subagent-workspace.js";

describe("skill triggers", () => {
  it("gates injection at 0.82", () => {
    expect(SKILL_TRIGGER_THRESHOLD).toBe(0.82);
    const triggers = [
      { id: "a", triggers: ["refactor trait", "impl dispatch"], contentPath: "s/a.md" },
    ];
    expect(matchingSkills("refactor trait impl dispatch", triggers)).toHaveLength(1);
    expect(matchingSkills("unrelated lunch plans", triggers)).toEqual([]);
  });
});

describe("verification guard", () => {
  it("requires tests for code edits, not docs", () => {
    expect(needsVerification(["src/lib.rs"], [])).toBe(true);
    expect(needsVerification(["src/lib.rs"], ["cargo test -p host-core"])).toBe(false);
    expect(needsVerification(["README.md"], [])).toBe(false);
    expect(verificationTurn(["src/lib.rs"])).toMatch(/Verification Required/);
  });
});

describe("subagent worktrees", () => {
  it("isolates delegates under .pi/worktrees", () => {
    expect(subagentWorktreePath("A1_B2")).toBe(".pi/worktrees/task-a1-b2");
    expect(subagentWorktreeBranch("A1_B2")).toBe("pi-task/a1-b2");
    expect(worktreeMergeSteps("x")).toHaveLength(4);
  });
});
