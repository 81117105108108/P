import { describe, expect, it } from "vitest";
import { assemblePrompt, isCacheHit } from "./cache-boundaries.js";
import { pruneBashOutput, pruneReadOutput } from "./history-pruning.js";
import { isTier1Task, resolveSmallModel } from "./model-routing.js";
import { clampThinkingBudget, thinkingBudget } from "./thinking-budgets.js";

describe("cache boundaries", () => {
  it("orders static → semi-static → dynamic", () => {
    expect(assemblePrompt({ static: "a", semiStatic: "b", dynamic: "c" })).toBe("a\n\nb\n\nc");
    expect(isCacheHit("a", "a")).toBe(true);
    expect(isCacheHit("a", "b")).toBe(false);
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
