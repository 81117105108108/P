/**
 * Strict prompt cache boundary alignment (ADR 0208).
 *
 * Anthropic/OpenAI/DeepSeek discount cache-hit prefixes up to 75–90% — but
 * only when the prefix is byte-identical across turns. Rule: static first,
 * semi-static on file change only, dynamic volatile suffix last.
 */

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

/** Assemble in cache-safe order with stable separators. */
export function assemblePrompt(blocks: CacheOrderedPrompt): string {
  return [blocks.static, blocks.semiStatic, blocks.dynamic]
    .map((b) => b.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Anthropic ephemeral marker for the cached prefix boundary. */
export function anthropicCacheBreak(): { type: "ephemeral" } {
  return { type: "ephemeral" };
}

/** True when the static prefix is unchanged (cache hit eligible). */
export function isCacheHit(previous: string, next: string): boolean {
  return previous === next;
}
