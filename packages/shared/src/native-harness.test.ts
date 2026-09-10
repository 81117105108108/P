import { describe, expect, it } from "vitest";
import { pruneCliOutput, readTombstone, stripTurnOutput } from "./compaction-pass.js";
import { losers, pickWinner, planSpeculative } from "./speculative.js";
import { isInspectableUrl, screenshotChecksum, validateInspectRequest } from "./inspect-ui.js";

describe("compaction pre-pass", () => {
  it("keeps fresh turns verbatim, tombstones stale reads", () => {
    const big = Array.from({ length: 150 }, (_, i) => `l${i}`).join("\n");
    expect(stripTurnOutput({ toolName: "Read", output: big, path: "a.ts" }, 1)).toBe(big);
    const tomb = stripTurnOutput({ toolName: "Read", output: big, path: "a.ts" }, 3);
    expect(tomb).toMatch(/File content pruned: 150 lines. Path: a\.ts/);
    expect(readTombstone(10, "p", "h")).toMatch(/Call Read to re-inspect/);
  });

  it("truncates CLI to head 5 + tail 10", () => {
    const log = Array.from({ length: 150 }, (_, i) => `o${i}`).join("\n");
    const out = pruneCliOutput(log, 2);
    expect(out).toMatch(/exit 2, kept first 5 \+ last 10 of 150/);
    expect(out).toContain("o0");
    expect(out).toContain("o149");
  });
});

describe("speculative best-of-N", () => {
  it("plans bounded fan-out and picks passing, minimal churn", () => {
    const plan = planSpeculative("fix", ["a", "b", "c", "d"], 2);
    expect(plan.taskIds).toEqual(["a", "b"]);
    const bids = [
      { delegationId: "1", taskId: "a", filesChanged: ["x"], testsPassed: false, churn: 5 },
      { delegationId: "2", taskId: "b", filesChanged: ["x"], testsPassed: true, churn: 50 },
      { delegationId: "3", taskId: "c", filesChanged: ["x"], testsPassed: true, churn: 4 },
    ];
    const win = pickWinner(bids)!;
    expect(win.delegationId).toBe("3");
    expect(losers(bids, win)).toEqual(["a", "b"]);
    expect(pickWinner([])).toBeUndefined();
  });
});

describe("inspect_ui contract", () => {
  it("allows loopback http(s) only and validates actions", () => {
    expect(isInspectableUrl("http://localhost:5173/")).toBe(true);
    expect(isInspectableUrl("https://example.com/")).toBe(false);
    expect(isInspectableUrl("file:///x")).toBe(false);
    expect(validateInspectRequest({ url: "http://localhost:1/", actions: [] })).toMatch(/at least one/);
    expect(
      validateInspectRequest({ url: "http://localhost:1/", actions: [{ kind: "snapshot", selector: " " }] }),
    ).toMatch(/selector/);
    expect(screenshotChecksum(new Uint8Array([1, 2, 3]))).toHaveLength(8);
  });
});
