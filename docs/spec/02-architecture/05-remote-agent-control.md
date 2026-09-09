# Remote Agent Control Target Architecture

- Status: Target specification; post-MVP
- Decision: D373 / ADR 0205
- Scope: Remote observation and control of a PI-Desktop Agent Host
- Source of truth: `03-runtime/19-remote-agent-control-protocol.md`

## 1. Scope and status

This document specifies the target architecture for controlling a PI-Desktop
Agent from another client. It does not enable a network listener in the
current desktop release and does not change the frozen MVP boundary in
`00-baseline.md` or ADR 0004.

The target capability lets an authenticated client:

- discover and attach to sessions owned by an Agent Host;
- start, observe, interrupt, and resume turns;
- receive ordered assistant, tool, approval, and lifecycle events;
- answer host-owned permission and input requests;
- reconnect after a transport failure without losing the session state; and
- use the same workspace, tool, secret, and permission boundaries as a local
  turn.

The feature is a control-plane API. It is not remote desktop streaming, an
arbitrary shell service, a provider proxy, or a replacement for the local
MCP control plane.

## 2. Design principles

1. **The Agent Host is the source of truth.** A client is a viewer and
   controller that may disconnect. A running turn is not owned by a browser
   tab or Electron window.
2. **The semantic contract is transport-neutral.** WebSocket JSON-RPC,
   HTTP/JSON + SSE, and gRPC expose the same session, turn, event, approval,
   and attachment semantics.
3. **Local boundaries remain local.** Rust host-core continues to speak only
   stdio NDJSON JSON-RPC with its trusted Electron Main or standalone host
   supervisor. The Node pi sidecar continues to reach host services through
   the main-process proxy.
4. **The public edge is a capability boundary.** Remote clients never receive
   raw `host.proxy`, Electron IPC, host-core RPC, provider credentials, or an
   arbitrary operation catalog.
5. **State synchronization is explicit.** Every remote event has a durable
   session cursor. Reconnect uses a cursor or a complete state snapshot; it
   never relies on wall-clock timestamps.
6. **Mutations are idempotent.** A lost response must not cause a second turn,
   duplicate approval, or repeated attachment mutation.
7. **A binding is replaceable.** A client may select a binding based on its
   capabilities without changing the Agent Host's behavior.

## 3. Reference implementations and design inputs

The design takes patterns from, but does not adopt wholesale, the following
public projects:

- [OpenAI Codex App Server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
  uses JSON-RPC-shaped messages over stdio and WebSocket, separates threads,
  turns, and items, streams lifecycle notifications, and sends approval
  requests from the server to the client.
- [VS Code Agent Host](https://github.com/microsoft/vscode-docs/blob/main/docs/agents/concepts/agent-host.md)
  puts the Agent in a dedicated host, keeps the host as the state source,
  supports remote JSON-RPC over WebSocket, and resynchronizes clients with
  snapshots and ordered actions.
- [MCP transports](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-03-26/basic/transports.mdx)
  demonstrate JSON-RPC over local stdio and independent-process HTTP with
  optional server-sent events.
- [Google A2A](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
  separates a canonical data model and abstract operations from JSON-RPC,
  gRPC, and HTTP/JSON bindings.

PI-Desktop does not revive the withdrawn subagent A2A/Peer channel. ADR 0165
continues to govern subagent coordination.

## 4. Logical components

| Component | Responsibility | Must not own |
|---|---|---|
| Remote Client | Render state, send user intent, answer approvals and input requests | Workspace authority, provider credentials, final permission decisions |
| Agent Host | Own sessions, turns, event cursors, attachment records, tool execution, and lifecycle | Browser presentation state |
| Gateway | Authenticate users, authorize routing, maintain host connections, rate-limit, and audit | Provider secrets, durable transcript truth, arbitrary host-core access |
| Electron Main adapter | Map the remote facade to existing main-owned handlers during migration | A second permission or persistence implementation |
| Node pi sidecar | Run the pi Agent loop and provider streams | Remote authentication, workspace policy, secret storage |
| Rust host-core | Own SQLite, tools, workspace boundaries, permissions, secrets, and durable local records | Public network listeners |

The logical Agent Host is the current Electron Main plus its supervised sidecars
during the first migration phase. The production target is a standalone host
process group that runs next to the workspace. The external contract is the
same in both deployments.

## 5. Deployment topologies

### 5.1 Current local desktop

This topology is unchanged:

```text
PI-Desktop
├── Electron Main
│   ├── Renderer
│   ├── Node pi sidecar
│   └── Rust host-core
└── local MCP control plane (optional, loopback-only)
```

The local MCP endpoint remains governed by ADR 0203. It is not a remote
Gateway and cannot be configured to bind a LAN or public interface.

### 5.2 Development or trusted LAN

```text
Remote Client ── WSS / SSH tunnel ── Agent Host
                                      ├── pi sidecar
                                      └── Rust host-core
```

Direct public exposure is not a supported production topology. A development
host may bind loopback and be reached through an authenticated SSH or device
tunnel. A trusted LAN deployment still requires TLS, authentication, and the
same authorization checks as a Gateway deployment.

### 5.3 Production Gateway

```text
Browser / Native Client ── HTTPS or WSS ── Remote Gateway
                                             │
                         outbound WSS or gRPC│
                                             ▼
                                      Agent Host
                                      ├── pi sidecar
                                      └── Rust host-core
```

The Agent Host opens the outbound connection. The Gateway does not require an
inbound port on the user's desktop and does not turn the host-core process into
a public service. The Gateway keeps a short-lived route from a host identity
to a live connection and may queue control-plane metadata, but it does not
queue non-idempotent turn commands while the Agent Host is offline.

## 6. Ownership and authority

### 6.1 Agent Host ownership

The Agent Host is authoritative for:

- session and turn state;
- the current operating mode and permission mode;
- the workspace/project binding;
- event sequence allocation and replay retention;
- approval and input request lifecycle;
- attachment ownership and hash verification;
- tool execution and result classification; and
- crash, abort, and no-replay behavior.

The Gateway and Remote Client must treat host responses as authoritative. A
client-side optimistic state is display-only.

### 6.2 Client roles

An authenticated principal receives one or more scoped roles per session:

- `viewer`: read session metadata and subscribe to events;
- `controller`: create or resume a turn, interrupt a turn, and upload input;
- `approver`: resolve permission and input requests allowed by policy; and
- `owner`: manage session membership, revoke clients, and archive a session.

Roles are additive but never bypass host policy. A `controller` cannot approve
its own request unless the policy explicitly grants the `approver` role.

Only one turn may run in a session. Multiple viewers are allowed. Concurrent
mutations are serialized by the Agent Host and rejected with a conflict when
their expected session revision is stale.

### 6.3 Gateway ownership

The Gateway owns identity-to-host routing, not workspace state. It may store:

- host registration and connection health;
- user/session membership and revocation metadata;
- rate-limit counters;
- audit metadata; and
- short-lived transport buffers.

It must not persist provider API keys, raw tool arguments, raw tool results, or
full transcripts unless a separate product decision explicitly grants that
retention.

## 7. Transport profiles

The protocol specification defines one abstract operation model and these
bindings:

| Profile | Intended client | Direction | Status |
|---|---|---|---|
| Local stdio JSON-RPC | Electron Main and sidecars | Full duplex | Existing; unchanged |
| `RACP-WS` JSON-RPC over WSS | Native clients, Electron, interactive browser control | Full duplex | Primary remote binding |
| `RACP-HTTP` HTTP/JSON + SSE | Browser and simple integrations | Commands plus server stream | Required browser binding |
| `RACP-GRPC` gRPC over TLS | Gateway-to-host and native service clients | Unary plus server stream | Required service binding |

The binding-neutral contract is specified in
`03-runtime/19-remote-agent-control-protocol.md`. A binding may be added only
when it preserves the same state transitions, error meaning, authorization
scope, event ordering, and cursor behavior.

## 8. Session and event synchronization

Each session has a monotonically increasing `sequence` allocated by the Agent
Host. The sequence is never reused for that session. Every event carries:

- `sessionId`;
- optional `turnId`;
- `eventId`;
- `sequence`;
- `stateRevision`;
- semantic `kind`; and
- a typed payload.

The first subscription response includes a snapshot and its `lastSequence`.
Subsequent events are ordered by `sequence`. A reconnect supplies
`afterSequence`:

```text
cursor retained  -> replay events with sequence > afterSequence
cursor expired   -> resync_required + current snapshot
cursor ahead     -> invalid cursor; client must refresh the snapshot
```

The Gateway must not renumber events. If the Gateway reconnects an Agent Host
link, it resumes using the last acknowledged host cursor. A client may render
events optimistically, but it must drop duplicates, pause on a gap, and apply a
snapshot before continuing.

## 9. Turn and approval path

```text
Client -> initialize / attach / subscribe
Client -> turn/start (idempotency key)
Host   -> accepted turn + initial cursor
Host   -> ordered turn and item events
Host   -> approval/request (when policy requires a decision)
Client -> approval/respond
Host   -> tool and turn events
Host   -> turn/completed | turn/interrupted | turn/failed
```

`turn/start` is an admission call. It returns quickly with a `turnId`; it must
not hold an HTTP request or gRPC unary call open until model execution ends.
The turn continues after the client disconnects. `turn/interrupt` is explicit
and idempotent; a transport disconnect alone never means interrupt.

Permission, Plan, and Goal approval rules remain host-owned. A remote client
can display a request and submit a decision, but cannot change a durable mode,
select an unadvertised permission mode, or execute a tool directly.

## 10. Failure and recovery model

| Failure | Required behavior |
|---|---|
| Client disconnect | Keep the turn running; retain events within the replay window |
| Client reconnect | Authenticate again, attach, replay from cursor or return snapshot |
| Gateway disconnect | Agent Host retries outbound link with bounded exponential backoff; local turns continue |
| Agent Host unavailable | Gateway rejects new mutations with `AGENT_UNAVAILABLE`; it does not replay them automatically |
| Agent Host crash | Existing host recovery rules apply; interrupted work is never replayed automatically |
| Duplicate mutation | Return the original idempotent result for the same principal and key |
| Event gap | Stop applying events and request a snapshot; never guess intermediate state |
| Slow client | Apply bounded send queues; disconnect with a resumable cursor when the queue is full |
| Expired approval | Return the existing approval timeout error; do not execute the tool |

## 11. Migration boundary

The first implementation must add a typed `RemoteAgentControlFacade` above the
existing Electron Main handlers. It may call the current session and Agent
handlers, but it must not call renderer IPC, `host.proxy`, or Rust host-core
RPC directly from a network listener.

The standalone Agent Host extraction may move the facade and supervision into
a new process without changing the wire contract. The migration is complete
when the local desktop, a standalone host, and a Gateway route expose the same
session/turn/event behavior.

## 12. Acceptance criteria

1. A remote client can attach to a session without taking ownership of its
   workspace path or secrets.
2. A turn continues after the initiating client disconnects.
3. A second client can observe the same turn and receive the same ordered
   events.
4. Reconnection either replays every event after the supplied cursor or
   returns a complete snapshot with an explicit resync reason.
5. Every mutation is idempotent and scoped to an authenticated principal.
6. Permission and input requests can be answered remotely without bypassing
   host policy.
7. Rust host-core remains unreachable from the network.
8. WebSocket, HTTP/SSE, and gRPC conformance tests produce equivalent domain
   results for the same command sequence.
9. The current local stdio JSON-RPC and loopback MCP paths remain unchanged.
