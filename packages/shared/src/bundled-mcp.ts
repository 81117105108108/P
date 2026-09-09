/**
 * Bundled MCP presets: first-run defaults that keep the core loop fast,
 * cheap, and low-context (ADR 0207).
 *
 * - `ast` routes structural code search to the local `sg` binary instead of
 *   broad text scans.
 * - `codebase-memory` answers "where is X / who calls Y" from the index.
 * - `semble` is the mandatory first text search before `sg`, then `rg`.
 *
 * Entries are loopback stdio commands. No secrets, no network by default.
 * The host seeds them only when the id is missing, never overwriting user edits.
 */

export type BundledMcpTransport = "stdio";

export type BundledMcpServer = {
  /** Stable registry id, e.g. `bundled.ast`. */
  id: string;
  label: string;
  transport: BundledMcpTransport;
  command: string;
  args: readonly string[];
  /** One line: when the MCP router should prefer this server. */
  when: string;
  /** Cost/quality note shown in the Extensions MCP page. */
  cost: string;
};

export const BUNDLED_MCP_SERVERS: readonly BundledMcpServer[] = [
  {
    id: "bundled.ast",
    label: "AST structural search (sg)",
    transport: "stdio",
    command: "sg",
    args: ["mcp"],
    when: "Use first for structural edits/searches (function/class/call-site). Cheaper than full-file reads.",
    cost: "Local process, no tokens until a match returns.",
  },
  {
    id: "bundled.codebase-memory",
    label: "Codebase memory graph",
    transport: "stdio",
    command: "codebase-memory-mcp",
    args: [],
    when: "Use first for symbol lookup, callers/callees, impact radius. Prefer over grep/glob.",
    cost: "Indexed lookup; ~500 tokens vs ~80K grep dumps.",
  },
  {
    id: "bundled.semble",
    label: "Semble text search",
    transport: "stdio",
    command: "semble",
    args: ["mcp"],
    when: "Mandatory first text search (semble → sg → rg). Line anchors only, then ranged Read.",
    cost: "Local index; top-k 5 keeps context flat.",
  },
];

/** Curated extras that earn their context cost; opt-in, never pre-enabled. */
export const CURATED_MCP_SUGGESTIONS: readonly BundledMcpServer[] = [
  {
    id: "suggested.context7",
    label: "Context7 library docs",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    when: "Library/framework API questions only. Replaces web search for docs.",
    cost: "On-demand; fetch one page, not the web.",
  },
];

/**
 * MCP router policy: smallest sufficient tool first, never broadcast.
 * Mirrors the Skill/ToolSearch on-demand pattern in agent-runtime.
 */
export const MCP_ROUTER_RULES: readonly string[] = [
  "semble search <query> <path> --top-k 5 before sg/rg",
  "sg structural -p '<pattern>' -l <lang> when text search is noisy",
  "codebase-memory search_graph/trace_path for definitions and callers",
  "ToolSearch to activate one MCP tool; deactivate after the turn",
  "never enable all MCP servers for one task",
];

export function bundledMcpIds(): string[] {
  return BUNDLED_MCP_SERVERS.map((s) => s.id);
}

export function findBundledMcp(id: string): BundledMcpServer | undefined {
  return BUNDLED_MCP_SERVERS.find((s) => s.id === id);
}
