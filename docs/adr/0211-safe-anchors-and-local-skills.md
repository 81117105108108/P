# ADR 0211: Fail-closed AST anchors and explicit local skill behavior

- Status: Accepted
- Date: 2026-09-09
- Amends: ADR 0207, ADR 0209, ADR 0210

## Evidence

The previous AstRewrite recovery replaced only the first line of a stale
multi-line block, not its complete span. Exact lookup silently chose the
first duplicate. Tree-sitter allowed any invalid result if the input already
contained an error. The two bundled skill plugins opened panels without
declaring a panel or its permission. Local provider presets lacked no-auth
metadata and the setup form waited for a key and persisted key-required auth.

## Decision

- AstRewrite requires a nonblank, unique, byte-exact full block and matching
  SHA256. Moved unchanged blocks work; content drift, including whitespace,
  fails closed. First-line, signature-only and fuzzy recovery are removed.
- For supported Tree-sitter languages the entire edited file must parse
  cleanly, even if it was already broken. This deliberately rejects edits
  that leave unrelated parse errors. Unsupported languages retain only the
  existing heuristic delimiter guard, not a full syntax guarantee.
- Caveman and Ponytail are first-party skill guidance, not upstream ports,
  persistent toggles, search services or panels. Remove their commands and
  retain on-demand skills and `agent.prompt.inject` permission.
- Ollama and LM Studio presets use `openai_compatible` and `authKind: none`.
  Setup discovers without a key and repairs auth on explicit save of an old
  row. No automatic database migration or secret deletion is performed.
- Local-Scout is an opt-in editor template, not a runtime builtin. A user
  must replace its model placeholder with a configured model. Existing model
  resolution rejects unavailable or ambiguous pins rather than substituting
  the parent model. No-auth session and subagent launch skip stored secrets.
- Preview first checks actual build files, the host binary and the installed
  Electron binary without importing Electron, downloading or deleting files.
  Packaged `dist-bundle` output is not a substitute for the development
  sidecar's `dist/sidecar.js`.

## Limits

No upstream Caveman/Ponytail integration, model installation, automatic local
routing, proof of model tool-call quality, grammar expansion, cross-process
atomic-write protocol, or E2E qualification is introduced by these repairs.
