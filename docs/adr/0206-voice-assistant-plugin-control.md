# ADR 0206: Voice Assistant plugin with a shared desktop controller

- Status: Accepted
- Date: 2026-09-10
- Decision: D374

## Context

PI-Desktop now has an opt-in local MCP control plane for the reviewed desktop
operation catalog. A user also needs a first-party voice surface that can speak
to a configured model and drive the same desktop without copying a bearer token
into plugin code or maintaining a second IPC allowlist.

The plugin runtime already isolates plugin code in a separate process and panel
pages in a sandboxed Electron session. Microphone access is a separate device
boundary that must remain opt-in and must not imply camera access.

## Decision

1. Ship `pi.voice` as a disabled-by-default bundled plugin.
2. Add the high-risk `desktop.control` permission and expose
   `pi.desktop.listOperations()` / `pi.desktop.invoke()` through the plugin
   host API.
3. Construct one desktop controller from the existing 150-operation reviewed
   registry. Local MCP and granted plugins use that controller; the plugin sees
   only operation id, description, and risk, never Electron channel names or
   the MCP bearer token.
4. Keep dangerous-operation confirmation in the shared controller. The voice
   panel must ask the user before invoking a dangerous operation; model output
   cannot set `confirm` on the user's behalf.
5. Add `ui.microphone`. A granted panel may request browser media audio, while
   the host continues to deny other device permissions. The plugin uses browser
   speech recognition/synthesis and keeps a text input fallback.
6. Use `agent.complete` for structured routing through the user's configured
   model. No external voice provider, plugin-owned API key, or plugin network
   allowlist is added by this decision.

## Consequences

- Voice commands can cover the full reviewed catalog as the catalog grows,
  while common project/session/Agent flows receive a dedicated UI path.
- The security review and renderer refresh callback are shared with MCP, so
  voice control cannot silently diverge from external-agent control.
- The user must explicitly grant a combined set of model, microphone, and
  desktop-control permissions; the plugin is not enabled automatically.
- Browser speech recognition behavior remains platform-dependent. The panel
  reports permission/recognition failures and remains usable through text.

## Alternatives rejected

- Giving the plugin the MCP connection token: rejected because it duplicates
  authentication and permits bypassing the plugin permission UI.
- Creating a second voice-specific IPC list: rejected because it would drift
  from the reviewed MCP catalog and its mutation event behavior.
- Bundling a hosted realtime speech provider: deferred; it would add network,
  credential, privacy, and cost decisions outside this MVP.
