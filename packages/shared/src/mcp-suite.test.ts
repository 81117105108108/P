import { describe, expect, it } from "vitest";
import {
  TOOL_CACHE_TURNS,
  evictColdTools,
  parseWarmTools,
  serializeWarmTools,
  warmTool,
} from "./mcp-lifecycle.js";
import { BASE_CONTEXT_TOOLS, scoreTool, topTools } from "./tool-index.js";
import { base64Url, createCodeVerifier, mcpAuthorizeUrl } from "./mcp-auth.js";

describe("mcp lifecycle LRU", () => {
  it("keeps tools warm for K=3 turns, then evicts", () => {
    expect(TOOL_CACHE_TURNS).toBe(3);
    let warm = warmTool([], "mcp_github_get", 1);
    expect(evictColdTools(warm, 2).map((t) => t.name)).toEqual(["mcp_github_get"]);
    expect(evictColdTools(warm, 4)).toEqual([]);
  });

  it("round-trips the session row and rejects garbage", () => {
    const warm = warmTool(warmTool([], "a", 1), "b", 2);
    expect(parseWarmTools(serializeWarmTools(warm))).toEqual(warm);
    expect(parseWarmTools("nope")).toEqual([]);
  });
});

describe("tool index", () => {
  it("keeps base context to five tools", () => {
    expect([...BASE_CONTEXT_TOOLS]).toEqual(["Read", "Edit", "Write", "Bash", "ToolSearch"]);
  });

  it("hydrates top matches first", () => {
    const index = [
      { name: "mcp_github_get_pr", description: "fetch pull request", keywords: ["github", "pr"] },
      { name: "mcp_slack_post", description: "send message", keywords: ["slack"] },
    ];
    expect(topTools(index, "github pull request")).toEqual(["mcp_github_get_pr"]);
    expect(topTools(index, "")).toEqual([]);
    expect(scoreTool(index[0], "github")).toBeGreaterThan(scoreTool(index[1], "github"));
  });
});

describe("mcp auth PKCE", () => {
  it("builds verifiers and authorize URLs", () => {
    const v = createCodeVerifier(64, () => 0.5);
    expect(v).toHaveLength(64);
    const url = mcpAuthorizeUrl({
      authorizeEndpoint: "https://example.com/oauth/authorize",
      clientId: "c",
      redirectUri: "http://localhost:4317/callback",
      state: "s",
      challenge: "ch",
    });
    expect(url).toMatch(/code_challenge=ch/);
    expect(base64Url(new Uint8Array([255]))).toBe("_w");
  });
});
