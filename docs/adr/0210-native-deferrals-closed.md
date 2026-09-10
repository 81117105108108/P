# ADR 0210: Native deferrals closed (grammars, sessions, PTY, Monaco, SSE, OAuth, skill harness)

- Status: Accepted
- Date: 2026-09-10
- Deciders: PI-Desktop core
- Related: ADR 0038, ADR 0048, ADR 0174, ADR 0203, ADR 0207, ADR 0208, ADR 0209

## Context

ADR 0209 shipped the native engine behind dependency-free facades and named
four follow-ups: Tree-sitter grammars, long-lived LSP multiplexing, true PTY
allocation, and Monaco/canvas bindings. Open alongside were legacy SSE MCP
transports, OAuth 401s on remote MCP endpoints (issue #96), and the stage-2
skill harness (`pi-plugin skill-test`).

## Decision

1. Tree-sitter (`tree-sitter 0.22`, Rust/TypeScript/Python/Go grammars):
   `ast::treesitter` parses, judges clean/dirty with error lines, finds
   enclosing definitions and named nodes. `FsCache::parse_or_load` caches
   trees by mtime. Patching rejects only *new* parse errors and recovers
   through real definitions; `AstGrep` reports `engine` plus `nodeKinds`.
2. LSP sessions (`lsp::session`): one supervised server per
   `(language, root)` over a single stdio pump with per-id routing,
   per-file diagnostics, versioned didOpen, transparent restart, and a
   process-wide `POOL` the `Lsp*` tools now use. Fixed a latent framing bug
   found by the duplex test: per-call `BufReader` wrapping dropped
   already-read bytes when frames coalesced.
3. PTY (`pty::session` over `portable-pty 0.8`): real ConPTY/pty spawn,
   background output pump with 512 KB cap, drain-with-timeout, resize, kill.
   Proven by a real echo round-trip test.
4. Renderer: `MonacoTarget` (lazy `monaco-editor` with worker env and
   textarea fallback) backs the diff target buffer; `DagCanvas` paints the
   same DAG node model on DPR-aware canvas with click select and a text
   fallback. No behavioral change to the hunk/node contracts.
5. MCP transports: legacy SSE (`transport: "sse"`) end to end — GET event
   stream with endpoint adoption, POST messages, inline-or-stream answers —
   validated in SDK (`plugin-sdk`), host (`plugins.rs`, `mcp_servers.rs`),
   shared types, and the Extensions editor (new card + 8-locale copy).
6. MCP OAuth: PKCE begin/complete/refresh (`mcp-oauth.ts` on shared
   `mcp-auth`), `McpOAuthVault` (memory access tokens, encrypted
   `secret:mcp:<id>:oauth` refresh tokens via the existing secrets store),
   per-send header rotation with refresh-once 401 retry in `McpServerClient`.
   The browser/callback login UX follows the provider OAuth pattern next.
7. Skills: `shared/skill-harness` (playbook runner with one matching
   fallback + golden scorer) and `pi-plugin skill-test --skill --goldens`
   gating prompt tweaks on trigger overlap plus taught vocabulary.

## Consequences

- New dependencies: tree-sitter stack, `portable-pty`, `streaming-iterator`
  (reserved), `monaco-editor` (renderer, lazy). GNU toolchain builds the
  grammar C sources; `cargo check` clean.
- Full `cargo test` failure set identical to clean main (15 pre-existing
  Windows-environment failures); new suites green: tree-sitter 5, sessions
  2, PTY 2, dispatch 4, SSE/OAuth 2, harness 4, UI 5.
- `plugin-devkit` templates symlink test still fails on Windows EPERM
  (pre-existing, needs Developer Mode).
- WebSocket MCP transport intentionally not added: SSE + streamable HTTP
  cover the MCP spec surface.
