/**
 * Two-tier MCP discovery: index-first ToolSearch (ADR 0208).
 *
 * Default context carries only base tools. ToolSearch scores the host-side
 * index and hydrates at most the top-3 schemas into the next request, so 20+
 * MCP servers cost catalog rows — never 15k–30k prompt tokens.
 */

/** Tools in every default request; everything else is on-demand. */
export const BASE_CONTEXT_TOOLS = ["Read", "Edit", "Write", "Bash", "ToolSearch"] as const;

/** Max schemas hydrated per ToolSearch call. */
export const TOOL_HYDRATE_TOP_K = 3;

export type IndexedTool = {
  name: string;
  description: string;
  keywords: readonly string[];
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 1);
}

/** BM25-flavored keyword score: name hits weigh 3x, keywords 2x. */
export function scoreTool(tool: IndexedTool, query: string): number {
  const q = new Set(tokens(query));
  if (!q.size) return 0;
  const name = new Set(tokens(tool.name));
  const desc = new Set(tokens(tool.description));
  const keys = new Set(tool.keywords.flatMap(tokens));
  let score = 0;
  for (const term of q) {
    if (name.has(term)) score += 3;
    if (keys.has(term)) score += 2;
    if (desc.has(term)) score += 1;
  }
  return score;
}

/** Top-K tool names for a query; empty query returns []. */
export function topTools(
  index: readonly IndexedTool[],
  query: string,
  k: number = TOOL_HYDRATE_TOP_K,
): string[] {
  return index
    .map((tool) => ({ tool, score: scoreTool(tool, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k))
    .map((r) => r.tool.name);
}
