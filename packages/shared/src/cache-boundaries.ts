/**
 * Strict prompt cache boundary alignment (ADR 0208).
 *
 * Anthropic/OpenAI/DeepSeek discount cache-hit prefixes up to 75–90% — but
 * only when the prefix is byte-identical across turns. Rule: static first,
 * semi-static on file change only, dynamic volatile suffix last.
 *
 * Wire-level markers and retention are owned by the pi-ai provider adapters
 * (default retention "short"; PI_CACHE_RETENTION=long); this module owns
 * byte order, prefix hashing, and invalidation diagnostics.
 */

import { stubChecksum } from "./history-pruning.js";

export const CACHE_BLOCKS = ["static", "semi-static", "dynamic"] as const;
export type CacheBlock = (typeof CACHE_BLOCKS)[number];

export type CacheOrderedPrompt = {
  /** Base role + core tool schemas. Byte-stable across turns. */
  static: string;
  /** Project instructions (AGENTS.md etc). Changes only on file edit. */
  semiStatic: string;
  /** MCP hydrations, history, current turn, attachments. */
  dynamic: string;
};

/** Trimmed non-empty segments in cache-safe order (static → semi-static → dynamic). */
export function promptSegments(blocks: CacheOrderedPrompt): string[] {
  return [blocks.static, blocks.semiStatic, blocks.dynamic]
    .map((b) => b.trim())
    .filter(Boolean);
}

/** Assemble in cache-safe order with stable separators. */
export function assemblePrompt(blocks: CacheOrderedPrompt): string {
  return promptSegments(blocks).join("\n\n");
}

/** Anthropic ephemeral marker for the cached prefix boundary. */
export function anthropicCacheBreak(): { type: "ephemeral" } {
  return { type: "ephemeral" };
}

/** True when the static prefix is unchanged (cache hit eligible). */
export function isCacheHit(previous: string, next: string): boolean {
  return previous === next;
}

/** FNV-1a identity of the static block (same checksum as history stubs). */
export function staticPrefixHash(blocks: CacheOrderedPrompt): string {
  return stubChecksum(blocks.static);
}

/** Cache invalidation diagnostic; null when the static prefix held. */
export type StaticPrefixChange = {
  cacheInvalidated: true;
  previousHash: string;
  nextHash: string;
};

/** Compare static-block hashes across turns. Null = cache hit eligible. */
export function staticPrefixChange(
  previous: CacheOrderedPrompt,
  next: CacheOrderedPrompt,
): StaticPrefixChange | null {
  const previousHash = staticPrefixHash(previous);
  const nextHash = staticPrefixHash(next);
  if (previousHash === nextHash) return null;
  return { cacheInvalidated: true, previousHash, nextHash };
}

/** Block-level cache invalidation attribution across turns. */
export type CacheInvalidationReport = {
  cacheInvalidated: boolean;
  staticChanged: boolean;
  semiStaticChanged: boolean;
  previousHash: string;
  nextHash: string;
};

/**
 * Attribute invalidation to the static or semi-static block. A semi-static-only
 * change is a partial invalidation: the static prefix still hits, so
 * `cacheInvalidated` stays false while the flag reports the drift.
 */
export function describeCacheInvalidation(
  previous: CacheOrderedPrompt,
  next: CacheOrderedPrompt,
): CacheInvalidationReport {
  const previousHash = staticPrefixHash(previous);
  const nextHash = staticPrefixHash(next);
  const staticChanged = previousHash !== nextHash;
  const semiStaticChanged =
    stubChecksum(previous.semiStatic) !== stubChecksum(next.semiStatic);
  return {
    cacheInvalidated: staticChanged,
    staticChanged,
    semiStaticChanged,
    previousHash,
    nextHash,
  };
}

/**
 * Cache mechanics differ per provider, so the same block order needs
 * different wire hints (ADR 0208): Anthropic caches explicit breakpoint
 * prefixes, OpenAI matches a stable `prompt_cache_key` prefix, DeepSeek
 * matches any repeated prefix automatically.
 */
export type CacheProvider = "anthropic" | "openai" | "deepseek" | "other";

export type CacheRequestTarget = {
  /** pi-ai wire API, e.g. "anthropic-messages", "openai-completions". */
  api?: string;
  /** models.dev provider key persisted as the provider row `vendorKey`. */
  vendorKey?: string;
  baseUrl?: string;
};

function requestHostname(baseUrl: string | undefined): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Derive the cache provider from a resolved request target. */
export function cacheProviderForRequest(target: CacheRequestTarget): CacheProvider {
  const vendorKey = target.vendorKey?.trim().toLowerCase() ?? "";
  const api = target.api?.trim().toLowerCase() ?? "";
  if (vendorKey === "anthropic" || api === "anthropic-messages") {
    return "anthropic";
  }
  if (vendorKey === "deepseek") return "deepseek";
  const host = requestHostname(target.baseUrl);
  if (host === "deepseek.com" || host.endsWith(".deepseek.com")) {
    return "deepseek";
  }
  if (
    vendorKey === "openai" ||
    api === "openai-completions" ||
    api === "openai-responses" ||
    api === "openai-codex-responses"
  ) {
    return "openai";
  }
  return "other";
}

/**
 * Provider-aware assembly result. `text` is byte-identical to
 * `assemblePrompt` for every provider — only the wire hints differ, so
 * cache-prefix equality is never at the mercy of the hint logic.
 */
export type ProviderCachePlan = {
  provider: CacheProvider;
  /** Assembled prompt bytes (same output as `assemblePrompt`). */
  text: string;
  /** Trimmed segments the text was joined from, in assembly order. */
  segments: string[];
  /**
   * 0-based segment after which an explicit ephemeral cache break belongs
   * (Anthropic only). Unset when no stable segment exists.
   */
  cacheBreakIndex?: number;
  /** Stable per-conversation key for providers with key-scoped caching. */
  promptCacheKey?: string;
  /** True when the static block must sit at byte 0 of the request prompt. */
  requiresStaticFirst: boolean;
};

/**
 * Plan prompt assembly for one provider. The Anthropic break lands after the
 * last stable (static/semi-static) segment; OpenAI forwards the caller's
 * stable `promptCacheKey`; DeepSeek relies on automatic prefix caching and
 * only requires static-first ordering.
 */
export function providerCachePlan(
  blocks: CacheOrderedPrompt,
  target: CacheRequestTarget,
  options: { promptCacheKey?: string } = {},
): ProviderCachePlan {
  const provider = cacheProviderForRequest(target);
  const segments = promptSegments(blocks);
  const text = segments.join("\n\n");
  const stableSegments =
    (blocks.static.trim() ? 1 : 0) + (blocks.semiStatic.trim() ? 1 : 0);
  const cacheBreakIndex = stableSegments > 0 ? stableSegments - 1 : undefined;

  if (provider === "anthropic") {
    return {
      provider,
      text,
      segments,
      ...(cacheBreakIndex !== undefined ? { cacheBreakIndex } : {}),
      requiresStaticFirst: true,
    };
  }
  if (provider === "openai") {
    return {
      provider,
      text,
      segments,
      ...(options.promptCacheKey ? { promptCacheKey: options.promptCacheKey } : {}),
      requiresStaticFirst: true,
    };
  }
  if (provider === "deepseek") {
    return { provider, text, segments, requiresStaticFirst: true };
  }
  return { provider, text, segments, requiresStaticFirst: false };
}
