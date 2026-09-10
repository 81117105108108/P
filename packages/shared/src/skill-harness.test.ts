import { describe, expect, it } from "vitest";
import { evaluateGoldens, runPlaybook } from "./skill-harness.js";

const handlers = {
  assert: (check: string) => check !== "db_missing",
  execute: (run: string) => (run === "migrate" ? "ok" : `out:${run}`),
  verify: (expect: string, output: string) => output.includes(expect.split(":")[0]),
};

describe("runPlaybook", () => {
  it("passes asserts, executes, and verifies", async () => {
    const report = await runPlaybook(
      {
        skillId: "s",
        steps: [
          { kind: "assert", check: "db_healthy" },
          { kind: "execute", run: "migrate" },
          { kind: "verify", expect: "ok: applied" },
        ],
      },
      handlers,
    );
    expect(report.ok).toBe(true);
  });

  it("aborts on a failed assert", async () => {
    const report = await runPlaybook(
      { skillId: "s", steps: [{ kind: "assert", check: "db_missing" }] },
      handlers,
    );
    expect(report.ok).toBe(false);
  });

  it("fires one matching fallback then re-verifies", async () => {
    const report = await runPlaybook(
      {
        skillId: "s",
        steps: [
          { kind: "execute", run: "flaky" },
          { kind: "verify", expect: "flaky done" },
          { kind: "fallback", run: "flaky done", when: "flaky" },
        ],
      },
      handlers,
    );
    expect(report.ok).toBe(true);
    expect(report.steps.some((s) => s.step.kind === "fallback")).toBe(true);
  });
});

describe("evaluateGoldens", () => {
  it("scores recorded answers without a model", () => {
    const reports = evaluateGoldens(
      [{ skillId: "s", question: "q", mustContain: ["alpha", "beta"] }],
      () => "Alpha and beta here",
    );
    expect(reports[0].pass).toBe(true);
    const failing = evaluateGoldens(
      [{ skillId: "s", question: "q", mustContain: ["gamma"] }],
      () => "nothing relevant",
    );
    expect(failing[0].pass).toBe(false);
    expect(failing[0].missing).toEqual(["gamma"]);
  });
});
