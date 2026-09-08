# ADR 0188: Import WorkBuddy sessions

- Status: Accepted
- Date: 2026-09-08
- Deciders: PI-Desktop core
- Related: ADR 0179, D007,
  `03-runtime/04-data-storage.md`, `04-ux/06-settings-ia.md`,
  `04-ux/08-component-spec.md` §18

## Context

Settings → Import scans Claude Code, Codex, OpenCode, and Pi session stores.
WorkBuddy (codebuddy.cn) keeps sessions at
`~/.workbuddy/projects/<slug>/<session-uuid>.jsonl` — a layout that mirrors
`~/.claude/projects/`, but the JSONL schema is not interchangeable:

- Messages are `type: "message"` with `role` at the top level, not
  `type: "user" | "assistant"` with a nested `message` object.
- Content blocks are OpenAI-shaped (`input_text`, `output_text`) rather than
  Anthropic-shaped (`text`, `tool_use`, `tool_result`).
- Tool calls are standalone `function_call` / `function_call_result` rows
  paired by `callId`, not blocks embedded in an assistant message.
- Pointers are `id` / `parentId`; timestamps are epoch milliseconds.
- A session carries an `ai-title` record, so titles do not have to be
  truncated out of the first user message.

Two properties need explicit handling:

1. **Injected context.** Every user turn is wrapped in a `<system-reminder>`
   block holding the system prompt, tool list, and memory reminders; after
   compaction a `<cb_summary>` or `<conversation_history_summary>` block
   appears. The real prompt lives in `<user_query>`. Reusing the Claude Code
   first-message heuristic would import a wall of system prompt as the session
   title and body. Compaction can also leave that block without its closing
   tag.
2. **Externalized tool results.** Results past an inline limit are written to
   `<session>/tool-results/call_*.txt`; the row keeps only a
   `<persisted-output>` stub with the path.

D007 keeps scans explicit, so a new source only adds another opt-in scan. No
`~/.pi` behavior changes.

## Decision

1. `workbuddy` becomes a fifth `ExternalSource` with its own importer at
   `electron/main/importers/workbuddy.ts`, registered alongside the existing
   four and surfaced through the existing `SessionImportPanel`.
2. **Titles** come from the `ai-title` record, falling back to the first real
   user prompt, then to the session id.
3. **Injected context** is stripped in three passes: remove paired
   `<system-reminder>` / `<cb_summary>` / `<conversation_history_summary>`
   blocks; prefer the `<user_query>` body so a real prompt survives a malformed
   wrapper; then drop anything from an unclosed opening tag to the end of the
   turn.
4. **Externalized results** are read back from the path in the
   `<persisted-output>` stub, but only when the resolved path stays inside
   `~/.workbuddy/projects`. Unreadable files keep the inline stub.
5. `reasoning` and `file-history-snapshot` records are not converted into
   messages.
6. `arguments` is a JSON string; it is parsed when possible and left as a
   string otherwise.

## Consequences

- The `source` column in the sessions table accepts `workbuddy`, and
  Settings → Import gains a fifth source group and label in every locale.
- Imported WorkBuddy sessions show AI-generated titles, which reads better
  than first-message truncation for the other sources.
- The importer reads one extra file per externalized tool result, bounded by
  the projects root path check.
- WorkBuddy schema drift is contained in one importer file; the other four
  importers are untouched.
