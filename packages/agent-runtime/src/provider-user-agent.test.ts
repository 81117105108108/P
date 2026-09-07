import { describe, expect, it, vi } from "vitest";
import {
  applyStoredUserAgentToInit,
  applyUserAgentToRequestInit,
  normalizeProviderUserAgent,
  runWithProviderUserAgent,
  withProviderUserAgent,
  withProviderUserAgentFetch,
  withUserAgentHeaders,
} from "./provider-user-agent.js";

describe("normalizeProviderUserAgent", () => {
  it("trims and treats empty as absent", () => {
    expect(normalizeProviderUserAgent("  Custom/1  ")).toBe("Custom/1");
    expect(normalizeProviderUserAgent("   ")).toBeUndefined();
    expect(normalizeProviderUserAgent(undefined)).toBeUndefined();
  });

  it("rejects CR/LF and oversize values", () => {
    expect(normalizeProviderUserAgent("bad\r\nX-Injected: 1")).toBeUndefined();
    expect(normalizeProviderUserAgent("x".repeat(257))).toBeUndefined();
    expect(normalizeProviderUserAgent("x".repeat(256))).toBe("x".repeat(256));
  });
});

describe("withUserAgentHeaders", () => {
  it("replaces any existing User-Agent key case-insensitively", () => {
    expect(
      withUserAgentHeaders(
        { "user-agent": "sdk", Accept: "application/json" },
        "Custom/1",
      ),
    ).toEqual({
      Accept: "application/json",
      "User-Agent": "Custom/1",
    });
  });

  it("leaves other headers alone when the override is empty", () => {
    expect(withUserAgentHeaders({ Accept: "application/json" }, "  ")).toEqual({
      Accept: "application/json",
    });
  });
});

describe("withProviderUserAgentFetch", () => {
  it("wins over a Codex-style last Headers.set of User-Agent", async () => {
    const captured: Headers[] = [];
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(new Headers(init?.headers));
      return new Response("ok");
    });
    const wrapped = withProviderUserAgentFetch(base, "Custom/1");
    const headers = new Headers();
    headers.set("X-Extra", "keep");
    headers.set("User-Agent", "pi (darwin 24.0; arm64)");
    await wrapped!("https://provider.example/v1", { headers });
    expect(captured[0].get("User-Agent")).toBe("Custom/1");
    expect(captured[0].get("X-Extra")).toBe("keep");
    expect(headers.get("User-Agent")).toBe("pi (darwin 24.0; arm64)");
  });

  it("does not wrap when the override is empty", () => {
    const base = vi.fn();
    expect(withProviderUserAgentFetch(base, "")).toBe(base);
    expect(withProviderUserAgentFetch(undefined, undefined)).toBeUndefined();
  });
});

describe("withProviderUserAgent", () => {
  it("puts User-Agent on stream headers and wraps fetch", async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("User-Agent")).toBe("Custom/1");
      return new Response("ok");
    });
    const result = withProviderUserAgent(
      {
        headers: { "x-opencode-session": "s1", "User-Agent": "pi-desktop/0.0.0" },
        fetch: base,
      },
      "Custom/1",
    );
    expect(result.headers).toMatchObject({
      "x-opencode-session": "s1",
      "User-Agent": "Custom/1",
    });
    await result.fetch!("https://opencode.ai/zen/go/v1", {
      headers: { "User-Agent": "still-sdk" },
    });
    expect(base).toHaveBeenCalledOnce();
  });
});

describe("runWithProviderUserAgent", () => {
  it("does not wrap the callback when the override is empty", () => {
    const fn = vi.fn(() => 7);
    expect(runWithProviderUserAgent("  ", fn)).toBe(7);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("exposes the scoped UA for a global fetch patch", () => {
    const outside = applyStoredUserAgentToInit({
      headers: { "User-Agent": "sdk" },
    });
    expect(new Headers(outside?.headers).get("User-Agent")).toBe("sdk");
    const inside = runWithProviderUserAgent("Custom/1", () =>
      applyStoredUserAgentToInit({ headers: { "User-Agent": "sdk" } }),
    );
    expect(new Headers(inside?.headers).get("User-Agent")).toBe("Custom/1");
  });
});

describe("applyUserAgentToRequestInit", () => {
  it("does not mutate the caller's Headers object", () => {
    const headers = new Headers({ "User-Agent": "sdk" });
    const next = applyUserAgentToRequestInit({ headers }, "Custom/1");
    expect(new Headers(next.headers).get("User-Agent")).toBe("Custom/1");
    expect(headers.get("User-Agent")).toBe("sdk");
  });
});
