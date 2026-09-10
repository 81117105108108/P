import { describe, expect, it } from "vitest";
import {
  NAMED_ENDPOINT_PRESETS,
  isLocalEndpoint,
  isLocalProviderPreset,
  isZhipuEndpoint,
  matchLocalPreset,
  matchNamedPreset,
  matchZhipuPreset,
  normalizeEndpointUrl,
  zhipuRequestCompat,
} from "./provider-presets.js";

describe("Zhipu endpoint presets", () => {
  it("distinguishes China API from Coding Plan by path", () => {
    expect(
      matchZhipuPreset({ baseUrl: "https://open.bigmodel.cn/api/paas/v4/" })?.id,
    ).toBe("zhipuai");
    expect(
      matchZhipuPreset({
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      })?.id,
    ).toBe("zhipuai-coding-plan");
  });

  it("distinguishes international API from Coding Plan by path", () => {
    expect(matchZhipuPreset({ baseUrl: "https://api.z.ai/api/paas/v4" })?.id).toBe(
      "zai",
    );
    expect(
      matchZhipuPreset({ baseUrl: "https://api.z.ai/api/coding/paas/v4" })?.id,
    ).toBe("zai-coding-plan");
  });

  it("maps pi-ai's China Coding Plan vendor key without treating it as z.ai", () => {
    expect(matchZhipuPreset({ vendorKey: "zai-coding-cn" })?.id).toBe(
      "zhipuai-coding-plan",
    );
    expect(matchZhipuPreset({ vendorKey: "zai-coding-cn" })?.vendorKey).toBe(
      "zhipuai-coding-plan",
    );
  });

  it("lets a Coding Plan URL win over a mismatched standard-API vendor key", () => {
    expect(
      matchZhipuPreset({
        vendorKey: "zai",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
      })?.id,
    ).toBe("zai-coding-plan");
  });

  it("does not treat OpenCode Go or a generic gateway as Zhipu", () => {
    expect(
      matchZhipuPreset({
        vendorKey: "custom",
        baseUrl: "https://opencode.ai/zen/go/v1",
      }),
    ).toBeUndefined();
    expect(
      isZhipuEndpoint({
        vendorKey: "custom",
        baseUrl: "https://api.example.com/v1",
      }),
    ).toBe(false);
  });

  it("attaches Zhipu thinking and tool-stream compat only for known endpoints", () => {
    expect(
      zhipuRequestCompat({ baseUrl: "https://open.bigmodel.cn/api/paas/v4" }),
    ).toEqual({ thinkingFormat: "zai", zaiToolStream: true });
    expect(
      zhipuRequestCompat({ baseUrl: "https://api.openai.com/v1" }),
    ).toBeUndefined();
  });

  it("normalizes trailing slashes for preset matching", () => {
    expect(normalizeEndpointUrl("https://API.z.ai/api/paas/v4/")).toBe(
      "https://api.z.ai/api/paas/v4",
    );
  });
});

describe("named endpoint presets", () => {
  it("only the local presets opt out of key authentication", () => {
    expect(NAMED_ENDPOINT_PRESETS.filter((preset) => preset.authKind === "none")
      .map((preset) => preset.id)).toEqual(["ollama", "lmstudio"]);
  });
  it("lists first-party vendors in one flat catalog, including Xiaomi", () => {
    const ids = NAMED_ENDPOINT_PRESETS.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "openai",
        "anthropic",
        "google",
        "openrouter",
        "opencode_go",
        "deepseek",
        "alibaba-cn",
        "zhipuai",
        "xiaomi",
      ]),
    );
    expect(NAMED_ENDPOINT_PRESETS.every((item) => !("group" in item))).toBe(true);
    expect(matchNamedPreset({ vendorKey: "xiaomi" })?.baseUrl).toBe(
      "https://api.xiaomimimo.com/v1",
    );
    expect(matchNamedPreset({ vendorKey: "mimo" })?.id).toBe("xiaomi");
  });

  it("binds first-party vendors to their published wire styles", () => {
    expect(matchNamedPreset({ vendorKey: "openai" })?.apiStyle).toBe("responses");
    expect(matchNamedPreset({ vendorKey: "anthropic" })?.apiStyle).toBe(
      "anthropic_messages",
    );
    expect(matchNamedPreset({ vendorKey: "google" })?.apiStyle).toBe(
      "google_generative_ai",
    );
    expect(
      matchNamedPreset({ baseUrl: "https://api.minimaxi.com/anthropic/v1" })?.apiStyle,
    ).toBe("anthropic_messages");
    expect(matchNamedPreset({ baseUrl: "https://api.minimaxi.com/v1" })).toMatchObject({
      id: "minimax-cn-openai",
      vendorKey: "minimax-cn",
      apiStyle: "chat_completions",
    });
  });

  it("maps DashScope and Doubao aliases to China catalog keys", () => {
    expect(matchNamedPreset({ vendorKey: "dashscope" })?.id).toBe("alibaba-cn");
    expect(matchNamedPreset({ vendorKey: "doubao" })?.id).toBe("volcengine");
  });

  it("keeps OpenCode Go as a named service, not a custom URL", () => {
    expect(
      matchNamedPreset({
        apiStyle: "opencode_go",
        baseUrl: "https://opencode.ai/zen/go/v1",
      })?.id,
    ).toBe("opencode_go");
  });

  it("ships local Ollama and LM Studio presets for subagent delegates", () => {
    expect(matchNamedPreset({ vendorKey: "ollama" })?.id).toBe("ollama");
    expect(matchNamedPreset({ vendorKey: "lmstudio" })?.id).toBe("lmstudio");
    expect(matchNamedPreset({ baseUrl: "http://localhost:11434/v1" })?.id).toBe(
      "ollama",
    );
    expect(matchNamedPreset({ baseUrl: "http://localhost:1234/v1/" })?.id).toBe(
      "lmstudio",
    );
  });
});

describe("local endpoint presets", () => {
  it("detects loopback gateways without treating cloud as local", () => {
    expect(isLocalEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(isLocalEndpoint("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalEndpoint("https://api.openai.com/v1")).toBe(false);
    expect(isLocalEndpoint(undefined)).toBe(false);
  });

  it("resolves local pins for easily configurable subagents", () => {
    expect(matchLocalPreset({ vendorKey: "ollama" })?.id).toBe("ollama");
    expect(
      isLocalProviderPreset({ baseUrl: "http://localhost:1234/v1" }),
    ).toBe(true);
    expect(isLocalProviderPreset({ vendorKey: "openai" })).toBe(false);
  });
});
