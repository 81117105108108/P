# ADR 0208: Core-loop performance, MCP hardening, skills disclosure, verification, cost controls

- Status: Accepted
- Date: 2026-09-10
- Deciders: PI-Desktop core
- Related: ADR 0048, ADR 0061, ADR 0062, ADR 0089, ADR 0104, ADR 0144, ADR 0186, ADR 0194, ADR 0203, ADR 0207

## Context

The solid core loop (ADR 0207) needs teeth: bulk IPC frames stall streams,
ToolSearch-activated MCP tools drop with TOOL_NOT_FOUND, skill bodies bloat
prompts, unverified patches land without tests, parallel delegates collide on
one workspace, and dynamic prompt prefixes destroy provider cache discounts.

## Decision

1. Bulk IPC policy (`shared/ipc-transport`): frames above 64 KB ride chunked
   `readRange` windows (default 200 lines, 4k chars/line), never one NDJSON
   frame. No transport change; callers stop buffering whole files.
2. MCP lifecycle (`shared/mcp-lifecycle`): LRU warm cache, K=3 turns, cap 12,
   serialized on the session row. Turn preflight evicts cold tools instead of
   clearing the set. Eliminates recurrent TOOL_NOT_FOUND without prompt bloat.
3. Two-tier discovery (`shared/tool-index`): default context carries Read,
   Edit, Write, Bash, ToolSearch only. ToolSearch scores the host index and
   hydrates top-3 schemas per call.
4. MCP auth (`shared/mcp-auth`): RFC 7636 PKCE URL/challenge builders in
   shared; code flow runs in Electron main; tokens persist in the OS keychain
   via the secrets adapter. SSE/WebSocket remain future transports.
5. Skills (`shared/skill-triggers`): id/triggers/path metadata, keyword
   preflight, inject at similarity ≥ 0.82 into the prompt suffix. Playbook
   (assert/execute/verify/fallback) and golden shapes typed for later.
6. Verification (`shared/agent-verification`): modified `.rs` → cargo test,
   `.ts` → pnpm test, `.py` → pytest. Missing runs inject one synthetic
   `[SYSTEM: Verification Required]` turn before completion.
7. Worktree isolation (`shared/subagent-workspace`): mutating delegates get
   `.pi/worktrees/task-<id>` on `pi-task/<id>`; parent reviews, merges,
   removes. Paths/branches/steps are pure helpers; git runs in main/host.
 8. Cache alignment (`shared/cache-boundaries`): assemble static →
    semi-static → dynamic; Anthropic ephemeral break at the static boundary;
    byte-equality decides hit eligibility. `staticPrefixHash` reuses the
    FNV-1a checksum from history stubs so callers can validate the static
    block across turns and emit a `staticPrefixChange` diagnostic when the
    cached prefix was silently invalidated. `providerCachePlan` keeps
    assembled bytes identical for every provider while deriving wire hints:
    Anthropic break index after the last stable segment, OpenAI
    `prompt_cache_key` passthrough, DeepSeek automatic prefix caching with
    static-first ordering.
9. History pruning (`shared/history-pruning`): stub stale Reads (≥100 lines)
   with line count + FNV checksum; tail Bash logs to exit + last 10 lines.
   Runs before any LLM summarizer call.
10. Routing (`shared/model-routing`): Tier-1 cheap tasks (toolsearch-match,
    session-title, compaction-summary, commit/pr summaries, triage-sweep) vs
    Tier-2 frontier (implement/refactor/debug/plan/synthesis). Small-model
    fallback: configured local model → user-chosen small provider model →
    current chat model; never invent one.
11. Thinking budgets (`shared/thinking-budgets`): exploratory ≤1,024 tokens;
    plan/synthesis 8,192–16,384; standard 4,096 default with clamps.

## Consequences

- Streams stay fluid on large repos; memory pressure capped by windows.
- MCP tools survive across turns; 20+ servers affordable via top-3 hydration.
- Skills cost zero until trigger match; playbooks/harness adoptable later.
- Patches verify before close; delegates stop corrupting shared checkouts.
- Cache-hit prefixes recover up to 75–90% provider discounts on repeats;
  pruning cuts 40–60% context before paid summarization.
- No host protocol, storage schema (beyond one warm-tools field), or
  permission-model changes. Rust/SSE transports deferred.
