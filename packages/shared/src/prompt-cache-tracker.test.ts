import { describe, expect, it } from "vitest";
import { PromptCacheTracker } from "./prompt-cache-tracker.js";

function blocks(staticText: string, dynamic = "turn") {
  return { static: staticText, semiStatic: "project", dynamic };
}

describe("PromptCacheTracker", () => {
  it("counts stable and invalidated static prefixes per turn", () => {
    const tracker = new PromptCacheTracker();
    const first = tracker.recordTurn("anthropic", blocks("role"));
    expect(first.turn).toBe(1);
    expect(first.cacheEligible).toBe(false);

    const second = tracker.recordTurn("anthropic", blocks("role", "turn 2"));
    expect(second.cacheEligible).toBe(true);
    expect(second.prefixHash).toBe(first.prefixHash);

    const third = tracker.recordTurn("anthropic", blocks("role v2"));
    expect(third.cacheEligible).toBe(false);

    const stats = tracker.statsFor("anthropic");
    expect(stats.turns).toBe(3);
    expect(stats.staticPrefixStableTurns).toBe(1);
    expect(stats.staticPrefixChangedTurns).toBe(1);
    expect(stats.lastInvalidatedTurn).toBe(3);
    expect(stats.prefixHash).toBe(third.prefixHash);
  });

  it("keeps providers isolated and snapshots deterministically", () => {
    const tracker = new PromptCacheTracker();
    tracker.recordTurn("openai", blocks("role"));
    tracker.recordTurn("anthropic", blocks("role"));
    tracker.recordTurn("openai", blocks("role"));

    expect(tracker.statsFor("openai").staticPrefixStableTurns).toBe(1);
    expect(tracker.statsFor("anthropic").staticPrefixStableTurns).toBe(0);
    expect(tracker.statsFor("unseen").turns).toBe(0);
    expect(tracker.snapshot().map((entry) => entry.provider)).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("accumulates provider usage and rates cache reads", () => {
    const tracker = new PromptCacheTracker();
    tracker.recordUsage("anthropic", {
      inputTokens: 100,
      cacheReadTokens: 300,
      cacheWriteTokens: 50,
    });
    tracker.recordUsage("anthropic", { inputTokens: 50, cacheReadTokens: 150 });

    const stats = tracker.statsFor("anthropic");
    expect(stats.inputTokens).toBe(150);
    expect(stats.cacheReadTokens).toBe(450);
    expect(stats.cacheWriteTokens).toBe(50);
    expect(stats.cacheReadReports).toBe(2);
    expect(stats.cacheHitRate).toBe(75);
  });

  it("leaves the rate undefined without a prompt denominator and resets cleanly", () => {
    const tracker = new PromptCacheTracker();
    tracker.recordUsage("anthropic", { cacheWriteTokens: 20 });
    expect(tracker.statsFor("anthropic").cacheHitRate).toBeUndefined();

    tracker.recordTurn("anthropic", blocks("role"));
    tracker.reset("anthropic");
    expect(tracker.statsFor("anthropic").turns).toBe(0);
    tracker.recordTurn("anthropic", blocks("role"));
    expect(tracker.statsFor("anthropic").staticPrefixStableTurns).toBe(0);
    expect(tracker.snapshot()).toHaveLength(1);
    tracker.reset();
    expect(tracker.snapshot()).toHaveLength(0);
  });
});
