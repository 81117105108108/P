# ADR 0209: Native core engine (cache/AST/LSP/CoW/PTY/rules) and desktop review surfaces

- Status: Accepted
- Date: 2026-09-10
- Deciders: PI-Desktop core
- Related: ADR 0048, ADR 0061, ADR 0062, ADR 0089, ADR 0104, ADR 0207, ADR 0208

## Context

Terminal-first competitors win on native speed: in-process AST rewriting,
embedded LSP, zero-byte workspace snapshots, and mtime caching. PI-Desktop
already owns the policy layer for all of these (hashline anchors, ToolSearch
deferral, worktree paths, rule hierarchy) but executes them as text over
pipes. The desktop shell can additionally review diffs, DAGs, and web UIs
visually — something a terminal cannot do.

## Decision

1. `cache::fs_cache`: mtime-keyed `FsCache` (std RwLock, SHA256, line
   offsets). No new dependencies.
2. `ast::{grep,patch}`: `$NAME` structural search (punctuation-aware tokens)
   and `HashEditRequest` patching — exact SHA256 apply, enclosing-item
   stale-anchor recovery, delimiter-balance syntax guard. Tree-sitter
   grammars slot behind the same API later; no C toolchain required today.
3. `lsp::{client,handlers}` + supervisor: Content-Length framing, request
   builders (initialize/didOpen/definition/references/hover/rename),
   binary discovery (rust-analyzer, vtsls/typescript-language-server,
   pyright, gopls), one-shot supervised query with diagnostics capture and
   guaranteed child cleanup. Long-lived multiplexing is the follow-up.
4. `iso::{cow,worktree}`: reflink snapshot (`cp -c`/`--reflink=auto`) with
   recursive-copy fallback that skips the destination subtree; git worktree
   fallback; numstat diff summaries.
5. `pty::detector` + supervised runner: ANSI stripping, sudo/ssh/shell/
   question classification, piped execution with timeouts and 10-line tails.
   True PTY allocation (`portable-pty`) is the follow-up.
6. `rules::discovery`: `.cursorrules`/`.clinerules`/`AGENTS.md`/`CLAUDE.md`
   upward hierarchy plus `.pi/rules/*.md`, nearest-first, 32 KB caps, ceiling
   parameter for isolation.
7. Tool wiring: `ReadRange`, `AstGrep`, `AstRewrite` (high risk),
   `LspDiagnostics/GotoDef/References/Hover`, `IsoCreate` (high),
   `IsoDiff`, `IsoDiscard` (high), `RulesGet`, `PtyCheck`. Read-only natives
   join the Plan allowlist; mutating natives stay Agent-only; path-taking
   natives join the external-path permission check.
8. Sidecar economics (`shared`): `compaction-pass` (K=2 tombstones, CLI
   head-5/tail-10), `speculative` (best-of-N fan-out/scoring), `inspect-ui`
   (loopback-only contract + checksums).
9. Renderer: `DiffReview` (hunk cherry-pick into editable target),
   `SubagentDag` (SVG running/verifying/failed/ready nodes), `InspectPanel`
   (DOM + styles + screenshot + drift flag). Monaco/canvas bindings later;
   the hunk/node/inspect models are stable.

## Consequences

- Zero new Cargo or npm dependencies; `cargo check` clean, all new unit
  tests green.
- 15 pre-existing Windows-environment cargo failures unchanged (verified
  identical on clean main); new suites add 31 Rust + 15 TS + 3 UI contract
  tests, all passing.
- LSP tools error honestly with install hints when no server is on PATH.
- No host protocol version change: new tools ride `tools.execute`/`tools.list`.
