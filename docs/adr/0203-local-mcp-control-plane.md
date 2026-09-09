# ADR 0203: Local MCP Control Plane for Desktop Operations

- Status: Accepted
- Date: 2026-09-09
- Decision: D370

## Context

PI-Desktop already has typed Electron-main IPC for projects, sessions, the pi
Agent, workspace views, plugins, settings, and other desktop operations. That
surface is available to the renderer only, so an external Agent cannot drive a
running desktop without a second application-specific integration. The remote
Gateway / WebUI control boundary remains out of scope under baseline decision
#20 and ADR 0004.

## Decision

- Add an optional Streamable HTTP MCP server inside Electron Main. It starts
  only when `PI_DESKTOP_MCP_CONTROL=1` is set and binds to `127.0.0.1`; an
  optional `PI_DESKTOP_MCP_PORT` selects the local port and defaults to 37123.
- Validate any supplied `Origin` against loopback hostnames to prevent DNS
  rebinding from remote web content. Non-browser MCP clients may omit `Origin`.
- Persist a random 256-bit bearer token in the Electron user-data directory and
  publish the current URL, token, PID, and active state in
  `mcp-control.json`. Write the token and manifest with mode `0600` where the
  platform supports POSIX permissions.
- Delegate every exposed call to the existing registered main-process IPC
  handler. Provide named tools for the common project/session/Agent/workspace
  flow and a generic `pi_desktop_invoke` over an explicit, risk-tagged catalog.
  `pi_control_describe` is the discovery surface for that catalog.
- Require `confirm: true` for dangerous generic operations and destructive
  named tools. Exclude secret get/set/delete channels and renderer-only native
  picker/dialog channels. A new IPC handler is not exposed automatically.
- After successful project/session/Agent calls, reuse the existing
  `pi-desktop/session/event/changed` renderer event with additive project and
  selection fields. Stop the server before host shutdown and mark the
  connection manifest inactive.

## Consequences

An external local Agent can open a project, create or inspect sessions, send a
prompt, observe status, and invoke reviewed desktop operations through a
standard MCP client. The renderer and external Agent converge through the same
IPC handlers and session refresh path, so there is no duplicated authorization
or persistence logic.

The endpoint grants a local client the authority of the running desktop for the
operations it invokes. Loopback binding, opt-in startup, bearer authentication,
bounded requests/results, explicit operation review, and confirmation gates
limit accidental exposure but do not protect against an untrusted process that
can read the user's application-data directory or token. Remote clients,
secret material, native pickers, and remote Gateway semantics remain excluded.

## Verification

`apps/desktop/test/mcp-control.test.mjs` covers token authentication,
initialization, tool discovery, project/session dispatch, dangerous-operation
confirmation, and inactive shutdown manifests. E2E-220 records the full
Electron journey; full local desktop E2E remains deferred by repository policy.
