/**
 * Per-provider User-Agent override.
 *
 * Adapters (pi-ai, Anthropic SDK, Codex) stamp their own User-Agent after
 * extra headers. A fetch wrapper is therefore the last writer, and the same
 * value is also placed on stream-option headers so OpenCode's "caller header
 * wins" rule stays true.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { FetchFunction, ProviderHeaders, SimpleStreamOptions } from "@earendil-works/pi-ai";

export const PROVIDER_USER_AGENT_MAX_BYTES = 256;

const oauthUserAgent = new AsyncLocalStorage<string>();
let globalFetchPatched = false;
let originalGlobalFetch: typeof globalThis.fetch | undefined;

export function normalizeProviderUserAgent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > PROVIDER_USER_AGENT_MAX_BYTES) return undefined;
  if (trimmed.includes("\r") || trimmed.includes("\n")) return undefined;
  return trimmed;
}

export function withUserAgentHeaders(
  headers: ProviderHeaders | Record<string, string> | undefined,
  userAgent: string | undefined,
): Record<string, string> | undefined {
  const normalized = normalizeProviderUserAgent(userAgent);
  const next: Record<string, string> = {};
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "user-agent") continue;
      if (typeof value === "string") next[key] = value;
    }
  }
  if (normalized) next["User-Agent"] = normalized;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function applyUserAgentToRequestInit(
  init: RequestInit | undefined,
  userAgent: string,
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", userAgent);
  return { ...(init ?? {}), headers };
}

export function withProviderUserAgentFetch(
  fetchFn: FetchFunction | undefined,
  userAgent: string | undefined,
): FetchFunction | undefined {
  const normalized = normalizeProviderUserAgent(userAgent);
  if (!normalized) return fetchFn;
  const baseFetch = fetchFn ?? globalThis.fetch.bind(globalThis);
  return (input, init) =>
    baseFetch(input, applyUserAgentToRequestInit(init, normalized));
}

/** Merge the override onto stream headers and wrap fetch so adapters cannot win. */
export function withProviderUserAgent(
  options: SimpleStreamOptions | undefined,
  userAgent: string | undefined,
): SimpleStreamOptions {
  const normalized = normalizeProviderUserAgent(userAgent);
  if (!normalized) return options ?? {};
  const headers = withUserAgentHeaders(options?.headers, normalized);
  const fetch = withProviderUserAgentFetch(options?.fetch, normalized);
  return {
    ...(options ?? {}),
    ...(headers ? { headers } : {}),
    ...(fetch ? { fetch } : {}),
  };
}

/**
 * Scope a User-Agent override to one async chain. Pair with
 * `installProviderUserAgentFetch` so pi-ai's global `fetch` (OAuth
 * login/refresh) honors the store. Empty store is a no-op.
 */
export function runWithProviderUserAgent<T>(
  userAgent: string | undefined,
  fn: () => T,
): T {
  const normalized = normalizeProviderUserAgent(userAgent);
  if (!normalized) return fn();
  return oauthUserAgent.run(normalized, fn);
}

export function applyStoredUserAgentToInit(
  init?: RequestInit,
): RequestInit | undefined {
  const ua = oauthUserAgent.getStore();
  if (!ua) return init;
  return applyUserAgentToRequestInit(init, ua);
}

/** Patch global fetch once so ALS-scoped OAuth HTTP can override User-Agent. */
export function installProviderUserAgentFetch(): void {
  if (globalFetchPatched) return;
  globalFetchPatched = true;
  originalGlobalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input, init) =>
    originalGlobalFetch!(input, applyStoredUserAgentToInit(init))) as typeof fetch;
}
