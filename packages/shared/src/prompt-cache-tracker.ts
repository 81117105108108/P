/**
 * Per-session prompt cache accounting (ADR 0208).
 *
 * The static prefix hash decides whether a turn was cache-eligible; provider
 * usage decides whether it actually hit. Counters stay deterministic and
 * provider-scoped so the Cost & Cache UI can report efficiency without
 * re-parsing transcript messages.
 */

import {
  staticPrefixHash,
  type CacheOrderedPrompt,
} from "./cache-boundaries.js";

/** Provider-reported usage subset relevant to prompt caching. */
export type PromptCacheUsage = {
  /** Uncached prompt tokens. */
  inputTokens?: number;
  /** Prompt tokens served from the provider cache. */
  cacheReadTokens?: number;
  /** Prompt tokens written to the provider cache. */
  cacheWriteTokens?: number;
};

export type PromptCacheTurn = {
  /** 1-based turn number recorded for this provider. */
  turn: number;
  /** Static prefix hash used for this turn. */
  prefixHash: string;
  /** True when the static prefix matched the previous turn (potential hit). */
  cacheEligible: boolean;
};

export type PromptCacheStats = {
  turns: number;
  /** Turns whose static prefix matched the previous turn. */
  staticPrefixStableTurns: number;
  /** Turns that invalidated a previously stable static prefix. */
  staticPrefixChangedTurns: number;
  /** Turn number of the most recent static-prefix invalidation. */
  lastInvalidatedTurn?: number;
  /** Current static prefix hash, unset before the first recorded turn. */
  prefixHash?: string;
  /** Uncached prompt tokens reported by the provider. */
  inputTokens: number;
  /** Prompt tokens served from the provider cache. */
  cacheReadTokens: number;
  /** Prompt tokens written to the provider cache. */
  cacheWriteTokens: number;
  /**
   * Usage reports that included cache reads. Tool loops report usage per
   * model request, so this can exceed `turns`.
   */
  cacheReadReports: number;
  /** Provider-reported prompt cache hit rate, 0-100. */
  cacheHitRate?: number;
};

function emptyStats(): PromptCacheStats {
  return {
    turns: 0,
    staticPrefixStableTurns: 0,
    staticPrefixChangedTurns: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheReadReports: 0,
  };
}

function tokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

/** cacheRead / (cacheRead + uncached input); same denominator as the usage UI. */
function cacheHitRate(
  inputTokens: number,
  cacheReadTokens: number,
): number | undefined {
  const promptTokens = inputTokens + cacheReadTokens;
  if (promptTokens <= 0) return undefined;
  return Math.round((cacheReadTokens / promptTokens) * 100);
}

/**
 * Tracks cache efficiency per provider for one session. Feed it every
 * assembled prompt (`recordTurn`) and every provider usage report
 * (`recordUsage`); read back aggregates via `statsFor`/`snapshot`.
 */
export class PromptCacheTracker {
  private readonly byProvider = new Map<string, PromptCacheStats>();
  private readonly prefixHashes = new Map<string, string>();

  /** Record one assembled prompt; reports whether its prefix held. */
  recordTurn(provider: string, blocks: CacheOrderedPrompt): PromptCacheTurn {
    const stats = this.ensure(provider);
    const prefixHash = staticPrefixHash(blocks);
    const previousHash = this.prefixHashes.get(provider);
    const cacheEligible = previousHash === prefixHash;
    stats.turns += 1;
    if (cacheEligible) {
      stats.staticPrefixStableTurns += 1;
    } else if (previousHash !== undefined) {
      stats.staticPrefixChangedTurns += 1;
      stats.lastInvalidatedTurn = stats.turns;
    }
    this.prefixHashes.set(provider, prefixHash);
    stats.prefixHash = prefixHash;
    return { turn: stats.turns, prefixHash, cacheEligible };
  }

  /** Accumulate one provider usage report (tool loops report per request). */
  recordUsage(provider: string, usage: PromptCacheUsage): void {
    const stats = this.ensure(provider);
    const inputTokens = tokenCount(usage.inputTokens);
    const cacheReadTokens = tokenCount(usage.cacheReadTokens);
    const cacheWriteTokens = tokenCount(usage.cacheWriteTokens);
    stats.inputTokens += inputTokens;
    stats.cacheReadTokens += cacheReadTokens;
    stats.cacheWriteTokens += cacheWriteTokens;
    if (cacheReadTokens > 0) stats.cacheReadReports += 1;
    const rate = cacheHitRate(stats.inputTokens, stats.cacheReadTokens);
    if (rate === undefined) {
      delete stats.cacheHitRate;
    } else {
      stats.cacheHitRate = rate;
    }
  }

  /** Copy of one provider's stats; empty (not recorded) providers stay untouched. */
  statsFor(provider: string): PromptCacheStats {
    const stats = this.byProvider.get(provider);
    return stats ? { ...stats } : emptyStats();
  }

  /** Deterministic provider-ordered snapshot for persistence or display. */
  snapshot(): Array<{ provider: string } & PromptCacheStats> {
    return [...this.byProvider.keys()]
      .sort()
      .map((provider) => ({ provider, ...this.statsFor(provider) }));
  }

  reset(provider?: string): void {
    if (provider === undefined) {
      this.byProvider.clear();
      this.prefixHashes.clear();
      return;
    }
    this.byProvider.delete(provider);
    this.prefixHashes.delete(provider);
  }

  private ensure(provider: string): PromptCacheStats {
    const existing = this.byProvider.get(provider);
    if (existing) return existing;
    const stats = emptyStats();
    this.byProvider.set(provider, stats);
    return stats;
  }
}
