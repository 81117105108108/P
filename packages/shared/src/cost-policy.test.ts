import { describe, expect, it } from "vitest";
import {
  assemblePrompt,
  cacheProviderForRequest,
  isCacheHit,
  providerCachePlan,
  promptSegments,
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

describe("provider cache plans", () => {
  const blocks = { static: "role", semiStatic: "project", dynamic: "turn" };

  it("detects providers from vendor key, wire api, or base URL", () => {
    expect(cacheProviderForRequest({ vendorKey: "anthropic" })).toBe("anthropic");
    expect(cacheProviderForRequest({ api: "anthropic-messages" })).toBe("anthropic");
    expect(cacheProviderForRequest({ vendorKey: "deepseek" })).toBe("deepseek");
    expect(cacheProviderForRequest({ baseUrl: "https://api.deepseek.com/v1" })).toBe("deepseek");
    expect(cacheProviderForRequest({ api: "openai-completions" })).toBe("openai");
    expect(cacheProviderForRequest({ vendorKey: "groq", api: "openai-completions" })).toBe("openai");
    expect(cacheProviderForRequest({ vendorKey: "mistral" })).toBe("other");
    expect(cacheProviderForRequest({ baseUrl: "not a url" })).toBe("other");
  });

  it("keeps assembled bytes identical for every provider", () => {
    for (const target of [
      { vendorKey: "anthropic" },
      { vendorKey: "openai" },
      { vendorKey: "deepseek" },
      { vendorKey: "mistral" },
    ]) {
      const plan = providerCachePlan(blocks, target);
      expect(plan.text).toBe(assemblePrompt(blocks));
      expect(plan.text).toBe("role\n\nproject\n\nturn");
    }
  });

  it("places the Anthropic break after the last stable segment", () => {
    expect(providerCachePlan(blocks, { vendorKey: "anthropic" }).cacheBreakIndex).toBe(1);
    expect(
      providerCachePlan({ ...blocks, semiStatic: " " }, { vendorKey: "anthropic" }).cacheBreakIndex,
    ).toBe(0);
    expect(
      providerCachePlan({ ...blocks, static: " ", semiStatic: " " }, { vendorKey: "anthropic" })
        .cacheBreakIndex,
    ).toBeUndefined();
  });

  it("forwards the OpenAI cache key and keeps DeepSeek automatic", () => {
    const openai = providerCachePlan(blocks, { vendorKey: "openai" }, { promptCacheKey: "session-1" });
    expect(openai.promptCacheKey).toBe("session-1");
    expect(openai.requiresStaticFirst).toBe(true);

    const deepseek = providerCachePlan(blocks, { vendorKey: "deepseek" }, { promptCacheKey: "ignored" });
    expect(deepseek.promptCacheKey).toBeUndefined();
    expect(deepseek.cacheBreakIndex).toBeUndefined();
    expect(deepseek.requiresStaticFirst).toBe(true);

    const other = providerCachePlan(blocks, { vendorKey: "mistral" });
    expect(other.cacheBreakIndex).toBeUndefined();
    expect(other.promptCacheKey).toBeUndefined();
    expect(other.requiresStaticFirst).toBe(false);
  });

  it("keeps segments aligned with the assembled bytes", () => {
    expect(promptSegments({ static: " a ", semiStatic: " ", dynamic: "b" })).toEqual(["a", "b"]);
    expect(providerCachePlan({ static: "a", semiStatic: "", dynamic: "b" }, { vendorKey: "anthropic" }).segments).toEqual(["a", "b"]);
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
