# ADR 0187: Separate task and interactive native notification delivery

- Status: Accepted
- Date: 2026-09-08
- Related: ADR 0107, D117, D350, E2E-065, E2E-065a

## Context

PR #84 added native notifications for asktool, tool-permission, and Plan
approval prompts by reusing the application-owned `notification/showNative`
handler. Its broader visibility predicate allowed a focused background terminal
completion to show a native banner. That regressed the existing task-notification
contract while trying to support focused-background interactive prompts.

## Decision

Keep one Electron-only application notification channel and add an optional
`source` field with two values:

- `"task"` identifies terminal completion/failure delivery. It remains
  unfocused-only, including when the focused window is viewing another session.
- `"interactive"` identifies asktool, tool-permission, and Plan approval
  prompts. It is suppressed only when the exact prompt session is visible in the
  focused window; a focused different session may receive the banner.

Application callers pass the source explicitly. Omitted or unknown values
default to `"task"` for compatibility and fail-safe delivery. Interactive
prompts remain native-only and do not create durable task inbox rows. Plugin
notifications continue through their separate permission-gated API and are not
part of this source field.

## Consequences

- Focused background terminal completions keep their durable row without a
  duplicate native banner.
- Users receive a native prompt reminder when a different session is focused,
  while the currently visible prompt remains inline-only.
- The source distinction is explicit at the Electron boundary and covered by
  unit and contract tests.
- The change is additive to the IPC payload and does not change host protocol,
  storage schema, or plugin permissions.

## Alternatives

### Keep one shared visibility predicate

Rejected because task outcomes and interactive prompts have different
user-visible suppression policies; a single predicate cannot preserve both
contracts.

### Add a second native-notification IPC channel

Rejected because it would duplicate validation, click activation, and native
delivery lifecycle code without adding a security boundary.

### Infer the source from notification ids or titles

Rejected because those fields are presentation data and do not provide a stable
or auditable policy boundary.
