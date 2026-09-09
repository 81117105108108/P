import { describe, expect, it } from "vitest";
import {
  CORE_LOOP_BUDGETS,
  DELEGATION_POLICY,
  SKILL_ROUTER_RULES,
  coreLoopSummary,
} from "./core-loop.js";

describe("core loop budgets", () => {
  it("keeps context windows bounded and cheap", () => {
    expect(CORE_LOOP_BUDGETS.sembleTopK).toBe(5);
    expect(CORE_LOOP_BUDGETS.transcriptWindow).toBeLessThanOrEqual(200);
    expect(CORE_LOOP_BUDGETS.retainedPanes).toBe(3);
    expect(CORE_LOOP_BUDGETS.providerRetries).toBe(10);
    expect(coreLoopSummary()).toMatch(/semble top-k 5/);
  });

  it("routes skills on demand, never bulk-loads bodies", () => {
    expect(SKILL_ROUTER_RULES.join("\n")).toMatch(/at most once per task/);
  });

  it("delegates sweeps, keeps single lookups inline", () => {
    expect(DELEGATION_POLICY.join("\n")).toMatch(/single-file lookup → inline/);
  });
});
