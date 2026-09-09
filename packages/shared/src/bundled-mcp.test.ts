import { describe, expect, it } from "vitest";
import {
  BUNDLED_MCP_SERVERS,
  CURATED_MCP_SUGGESTIONS,
  MCP_ROUTER_RULES,
  bundledMcpIds,
  findBundledMcp,
} from "./bundled-mcp.js";

describe("bundled MCP presets", () => {
  it("ships ast + codebase-memory + semble as loopback stdio", () => {
    expect(bundledMcpIds()).toEqual([
      "bundled.ast",
      "bundled.codebase-memory",
      "bundled.semble",
    ]);
    for (const server of BUNDLED_MCP_SERVERS) {
      expect(server.transport).toBe("stdio");
      expect(server.command.trim().length).toBeGreaterThan(0);
      expect(server.when.trim().length).toBeGreaterThan(0);
    }
  });

  it("never duplicates ids across bundled and curated lists", () => {
    const ids = [...bundledMcpIds(), ...CURATED_MCP_SUGGESTIONS.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds bundled entries by id", () => {
    expect(findBundledMcp("bundled.ast")?.command).toBe("sg");
    expect(findBundledMcp("missing")).toBeUndefined();
  });

  it("router policy stays minimal and ordered semble → sg → graph", () => {
    expect(MCP_ROUTER_RULES[0]).toMatch(/semble/);
    expect(MCP_ROUTER_RULES.join("\n")).toMatch(/ToolSearch/);
  });
});
