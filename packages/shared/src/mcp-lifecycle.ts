/**
 * MCP tool lifecycle: LRU active-tool cache per session (ADR 0208, issue #102).
 *
 * Root cause: `resetDeferredToolsForPrompt` clears the active set every turn,
 * so a ToolSearch-activated MCP tool drops with TOOL_NOT_FOUND on the next
 * turn. Fix: keep tools warm for K consecutive turns (persisted on the session
 * entity), evicting least-recently-used — never a blind per-turn reset.
 */

/** Consecutive turns an activated tool stays warm without re-search. */
export const TOOL_CACHE_TURNS = 3;
/** Cap so the warm set cannot grow into prompt bloat. */
export const MAX_WARM_TOOLS = 12;

export type WarmTool = { name: string; lastTurn: number };

/** Record activation of `name` at `turn`. Returns the new warm list. */
export function warmTool(
  warm: readonly WarmTool[],
  name: string,
  turn: number,
): WarmTool[] {
  const next = warm.filter((t) => t.name !== name);
  next.push({ name, lastTurn: turn });
  return next.slice(-MAX_WARM_TOOLS);
}

/**
 * Evict tools idle for TOOL_CACHE_TURNS or more. Call at turn preflight
 * instead of clearing the whole set.
 */
export function evictColdTools(
  warm: readonly WarmTool[],
  turn: number,
): WarmTool[] {
  return warm.filter((t) => turn - t.lastTurn < TOOL_CACHE_TURNS);
}

/** Names the provider request may reference without TOOL_NOT_FOUND. */
export function warmToolNames(warm: readonly WarmTool[]): string[] {
  return warm.map((t) => t.name);
}

/** Serialize for the SQLite session row; parse with `parseWarmTools`. */
export function serializeWarmTools(warm: readonly WarmTool[]): string {
  return JSON.stringify(warm.slice(-MAX_WARM_TOOLS));
}

export function parseWarmTools(raw: unknown): WarmTool[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is WarmTool =>
          !!t &&
          typeof t === "object" &&
          typeof (t as WarmTool).name === "string" &&
          typeof (t as WarmTool).lastTurn === "number",
      )
      .slice(-MAX_WARM_TOOLS);
  } catch {
    return [];
  }
}
