# ADR 0207: Local-model subagents, bundled MCPs, and solid core loop

- Status: Accepted
- Date: 2026-09-09
- Deciders: PI-Desktop core
- Related: ADR 0062, ADR 0089, ADR 0104, ADR 0174, ADR 0203

> Safety correction: ADR 0211 supersedes the plugin capability and local
> setup claims below. The plugins are first-party skill-only guidance with
> `agent.prompt.inject`, not upstream integrations or command-driven modes.
> Local-Scout requires explicit configuration; local routing is not automatic.

## Context

Cloud tokens dominate cost. Broad sweeps (grep/glob triage, first-pass
navigation) do not need the strongest model, but today every delegate pins a
cloud provider or inherits the session model. Text search starts anywhere,
full files enter context, and every MCP/skill body ships up front. Two useful
interaction styles (terse Caveman replies, parallel Ponytail sweeps) live only
as external prompts.

## Decision

1. Local-first subagent pins: `ollama` (`http://localhost:11434/v1`) and
   `lmstudio` (`http://localhost:1234/v1`) are first-class
   `chat_completions` presets with `authKind: none`. `isLocalEndpoint`,
   `matchLocalPreset`, `isLocalModelPin`, and `localSubagentPin` make
   `ollama/<model-id>` paste-ready. `LOCAL_SUBAGENT_TEMPLATE`
   (`local-scout`, Read/Glob/Grep, 40 turns) stays out of the four builtins
   so the default menu is unchanged.
2. Bundled MCPs: `bundled.ast` (`sg mcp`), `bundled.codebase-memory`, and
   `bundled.semble` ship as loopback stdio presets with router hints. Host
   seeds missing ids only, never overwrites user edits. `context7` stays a
   curated opt-in suggestion.
3. Routers, not bulk-loads: Semble top-k 5 → sg structural → ranged Read;
   Skill catalog (id/name/description) + `Skill(id)` at most once per task;
   `ToolSearch` activates one MCP tool per turn. `MCP_ROUTER_RULES`,
   `SKILL_ROUTER_RULES`, `CORE_LOOP_BUDGETS`, and `DELEGATION_POLICY` are the
   single constants.
4. Preinstalled plugins: `pi.caveman` (terse mode) and `pi.ponytail`
   (parallel sweep) ship under `resources/plugins` like `pi.files`. No host
   privileges, no permissions, skill bodies load on demand. They ride the
   same reconciliation (`PI_DESKTOP_BUILTIN_PLUGINS_DIR`) as existing
   bundled plugins.
5. Core-loop budgets stay bounded: transcript window 200, panes 3,
   delegations 100, provider retries 10, permission timeout 120s. Single-file
   lookups stay inline; sweeps delegate to a cheap local model.

## Consequences

- Sweeps run on loopback models with zero key/proxy cost; judgments stay on
  cloud models. Context stays flat via top-k, windows, and on-demand bodies.
- MCP/skill surface no longer scales with install count; prompt cost is
  catalog-only until use.
- Two new bundled plugins increase install size marginally but add no
  permission surface and no background services.
- No host protocol, storage schema, or permission-model changes. Local
  endpoints are loopback-only; non-loopback HTTP MCP still warns.
