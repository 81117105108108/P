import { describe, expect, it } from "vitest";
import {
  assemblePrompt,
  isCacheHit,
  staticPrefixChange,
  staticPrefixHash,
} from "./cache-boundaries.js";
import { pruneBashOutput, pruneReadOutput } from "./history-pruning.js";
import { isTier1Task, resolveSmallModel } from "./model-routing.js";
import { clampThinkingBudget, thinkingBudget } from "./thinking-budgets.js";

describe("cache boundaries", () => {
  it("orders static → semi-static → dynamic", () => {
    expect(assemblePrompt({ static: "a", semiStatic: "b", dynamic: "c" })).toBe("a\n\nb\n\nc");
    expect(isCacheHit("a", "a")).toBe(true);
    expect(isCacheHit("a", "b")).toBe(false);
  });

  it("hashes the static block for cross-turn validation", () => {
    const blocks = { static: "role + tools", semiStatic: "project", dynamic: "turn" };
    expect(staticPrefixHash(blocks)).toBe(staticPrefixHash({ ...blocks, semiStatic: "changed", dynamic: "changed" }));
    expect(staticPrefixHash(blocks)).not.toBe(staticPrefixHash({ ...blocks, static: "role + tools v2" }));
  });

  it("flags static prefix invalidation, passes unchanged prefixes", () => {
    const previous = { static: "role", semiStatic: "p", dynamic: "d" };
    const next = { static: "role", semiStatic: "p", dynamic: "d2" };
    expect(staticPrefixChange(previous, next)).toBeNull();
    const changed = staticPrefixChange(previous, { ...next, static: "role v2" });
    expect(changed).not.toBeNull();
    expect(changed?.cacheInvalidated).toBe(true);
    expect(changed?.previousHash).toMatch(/^[0-9a-f]{8}$/);
    expect(changed?.nextHash).toMatch(/^[0-9a-f]{8}$/);
    expect(changed?.previousHash).not.toBe(changed?.nextHash);
  });
});

describe("history pruning", () => {
  it("stubs stale reads and tails logs", () => {
    const big = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    expect(pruneReadOutput(big)).toMatch(/File content pruned: 150 lines/);
    expect(pruneReadOutput("short")).toBe("short");
    expect(pruneBashOutput(big, 1)).toMatch(/kept last 10 of 150 lines, exit 1/);
  });
});

describe("model routing fallback", () => {
  it("tiers cheap work and cascades local → small → current", () => {
    expect(isTier1Task("session-title")).toBe(true);
    expect(isTier1Task("implement")).toBe(false);
    expect(
      resolveSmallModel({ localModel: "ollama/qwen", userSmallModel: "openai/gpt-4o-mini", currentModel: "anthropic/opus" }),
    ).toBe("ollama/qwen");
    expect(
      resolveSmallModel({ userSmallModel: "openai/gpt-4o-mini", currentModel: "anthropic/opus" }),
    ).toBe("openai/gpt-4o-mini");
    expect(resolveSmallModel({ currentModel: "anthropic/opus" })).toBe("anthropic/opus");
    expect(resolveSmallModel({ currentModel: " " })).toBeUndefined();
  });
});

describe("thinking budgets", () => {
  it("constrains scouts, reserves depth for plans", () => {
    expect(thinkingBudget("exploratory")).toBe(1024);
    expect(clampThinkingBudget("exploratory", 8192)).toBe(1024);
    expect(clampThinkingBudget("plan", 99999)).toBe(16384);
    expect(clampThinkingBudget("plan", 10)).toBe(8192);
  });
});
