# 19. Remote Agent Control Protocol

- Protocol name: `PI Remote Agent Control Protocol` (`RACP`)
- Version: `1.0`
- Status: Target specification; post-MVP
- Decision: D373 / ADR 0205
- Transport profiles: `RACP-WS`, `RACP-HTTP`, `RACP-GRPC`

This document is normative for the remote control contract. It defines the
operation model once and maps it to multiple transports. It does not change
the existing Electron IPC, sidecar JSON-RPC, Rust host-core RPC, or local MCP
protocols.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are to be interpreted as requirements for a future implementation.

## 1. Contract boundaries

RACP controls a running Agent Host. It is not:

- a public version of Electron IPC;
- a public version of `host.proxy`;
- a host-core network protocol;
- a provider or model API proxy;
- an arbitrary command/shell API;
- the local MCP control plane; or
- the withdrawn subagent A2A/Peer protocol.

The Agent Host remains responsible for authentication context, authorization,
workspace selection, tool policy, permission decisions, persistence, and
provider credentials. A RACP server MUST route a request through those same
authorities rather than reproducing them in a Gateway or client.

## 2. Terminology

| Term | Meaning |
|---|---|
| Host | The logical Agent Host that owns sessions and executes turns |
| Client | A UI, CLI, native application, or service controlling a Host |
| Gateway | An optional authenticated router between Clients and Hosts |
| Session | A durable conversation and workspace/project binding |
| Turn | One accepted prompt and its model/tool lifecycle |
| Item | A durable or streamed unit inside a turn, such as a message or tool call |
| Event | An ordered state or progress notification for a Session |
| Cursor | A Session-scoped event sequence position |
| Principal | The authenticated user, device, service, or Gateway identity |
| Binding | A transport-specific encoding of the RACP operations |

## 3. Version and initialization

Every remote connection MUST begin with `connection/initialize`. No other
request, notification, or server request is valid before the initialization
response and the client's `notifications/initialized` notification.

The client sends:

```json
{
  "jsonrpc": "2.0",
  "id": "init-1",
  "method": "connection/initialize",
  "params": {
    "protocolVersion": "1.0",
    "client": {
      "name": "pi-desktop-web",
      "version": "0.1.0"
    },
    "bindings": ["RACP-WS", "RACP-HTTP"],
    "capabilities": {
      "eventReplay": true,
      "approvals": true,
      "inputRequests": true,
      "attachments": true
    },
    "maxReceiveBytes": 1048576
  }
}
```

The Host returns:

```json
{
  "jsonrpc": "2.0",
  "id": "init-1",
  "result": {
    "protocolVersion": "1.0",
    "server": {
      "name": "pi-desktop-agent-host",
      "version": "0.1.0"
    },
    "connectionId": "conn_01J...",
    "principal": {
      "subject": "user_123",
      "roles": ["viewer", "controller"]
    },
    "capabilities": {
      "eventReplay": true,
      "snapshot": true,
      "approvals": true,
      "inputRequests": true,
      "attachments": true,
      "serverRequests": true,
      "bindings": ["RACP-WS", "RACP-HTTP", "RACP-GRPC"]
    },
    "limits": {
      "maxFrameBytes": 1048576,
      "maxPromptBytes": 262144,
      "maxAttachmentBytes": 52428800,
      "maxSubscriptionsPerConnection": 8
    }
  }
}
```

The Host MUST reject unsupported major versions with `PROTOCOL_MISMATCH`.
Minor-version additions are compatible when the client can ignore unknown
fields and the Host does not require an unadvertised capability.

## 4. Message envelopes

### 4.1 JSON-RPC profiles

`RACP-WS` uses JSON-RPC 2.0 messages. Each WebSocket text frame contains one
complete UTF-8 JSON-RPC message. Binary frames are rejected. JSON-RPC batch
requests are not supported for mutations.

`RACP-HTTP` maps each operation to one HTTP request with an equivalent JSON
operation body; it does not require a JSON-RPC envelope. Responses are JSON
domain objects. The request context is carried in the operation body and, where
available, the equivalent `X-Request-Id`, `Idempotency-Key`, and
`If-Match-Revision` headers. Event streaming uses `text/event-stream`; each
SSE `data` field contains one `EventEnvelope` JSON object, not a JSON-RPC
notification.

Requests that mutate state MUST include an application-level
`idempotencyKey`, stable for the lifetime of a retry. JSON-RPC `id` identifies
the transport request; it is not the idempotency key.

### 4.2 Common request fields

```ts
type RequestContext = {
  requestId: string
  idempotencyKey?: string
  expectedRevision?: number
  traceparent?: string
}
```

The binding maps `RequestContext` into the JSON-RPC `params.context` object,
HTTP headers, or gRPC metadata. A Gateway MUST preserve the context values and
MUST NOT replace an idempotency key while retrying a request.

### 4.3 Server notifications and requests

The WebSocket binding MAY send server notifications and server-initiated
requests. A server request has its own JSON-RPC id and MUST receive a response
on the same connection.

The HTTP/SSE binding cannot require a client to answer a server-initiated JSON-
RPC request. It represents approval and input requests as events and requires
the client to call the corresponding `approval/respond` or `input/respond`
HTTP endpoint.

## 5. Canonical resources

The following JSON shapes define the semantic model. A future Protobuf file MAY
be generated from this model, but every binding MUST preserve field meaning and
state transitions.

### 5.1 Session

```ts
type Session = {
  id: string
  projectId?: string
  workspaceLabel?: string
  mode: "agent" | "plan" | "goal"
  status: "idle" | "running" | "waiting_permission" | "aborted" | "error"
  permissionMode: "ask" | "accept-edits" | "auto"
  activeTurnId?: string
  revision: number
  createdAt: string
  updatedAt: string
}
```

An absolute workspace path MUST NOT be included unless the principal has an
explicit path-disclosure scope. A `workspaceLabel` is display-only.

### 5.2 Turn

```ts
type Turn = {
  id: string
  sessionId: string
  status:
    | "queued"
    | "running"
    | "waiting_approval"
    | "waiting_input"
    | "completed"
    | "interrupted"
    | "failed"
    | "canceled"
  clientRequestId?: string
  startedAt?: string
  endedAt?: string
  error?: RemoteError
}
```

Only one `queued`, `running`, `waiting_approval`, or `waiting_input` turn may
exist per session. Terminal turns are immutable.

### 5.3 Event envelope

```ts
type EventEnvelope = {
  eventId: string
  sessionId: string
  turnId?: string
  sequence: number
  stateRevision: number
  kind:
    | "session.changed"
    | "turn.started"
    | "turn.completed"
    | "turn.interrupted"
    | "turn.failed"
    | "item.started"
    | "item.delta"
    | "item.completed"
    | "tool.progress"
    | "approval.requested"
    | "approval.resolved"
    | "input.requested"
    | "input.resolved"
    | "resync.required"
  occurredAt: string
  payload: unknown
}
```

`sequence` is allocated by the Host, starts at `1` for a new Session, is
strictly increasing, and is never derived from `occurredAt`. A Gateway MUST
forward it unchanged.

### 5.4 Snapshot

```ts
type SessionSnapshot = {
  session: Session
  activeTurn?: Turn
  items: ItemSummary[]
  lastSequence: number
  snapshotRevision: number
  generatedAt: string
}
```

The item list is bounded and may end with `hasMoreHistory: true`. A snapshot is
valid only with its `lastSequence` and `snapshotRevision`.

### 5.5 Approval and input request

```ts
type ApprovalRequest = {
  id: string
  sessionId: string
  turnId: string
  kind: "tool" | "plan" | "goal"
  summary: string
  toolName?: string
  expiresAt: string
  allowedDecisions: Array<"approve" | "reject" | "cancel">
  requestedPermissionMode?: "ask" | "accept-edits" | "auto"
}

type InputRequest = {
  id: string
  sessionId: string
  turnId: string
  prompt: string
  questions: Array<{
    id: string
    label: string
    options?: string[]
    secret: boolean
  }>
  expiresAt: string
}
```

Approval summaries MUST be safe to display. Raw provider credentials, secret
values, and unbounded tool results are never included in an approval request.

### 5.6 Attachment

```ts
type Attachment = {
  id: string
  sessionId: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string
  status: "pending" | "ready" | "expired" | "rejected"
  expiresAt: string
}
```

Remote turns reference attachment ids. They MUST NOT send a local absolute path
and MUST NOT make a remote client path visible to host tools.

## 6. Operation catalog

All operation names are lower-case, singular-resource paths. The JSON-RPC,
HTTP, and gRPC bindings map to this same catalog.

| Operation | Role | Behavior |
|---|---|---|
| `connection/initialize` | authenticated | Negotiate protocol and capabilities |
| `connection/ping` | authenticated | Return connection health and server time |
| `session/list` | viewer | List sessions visible to the principal |
| `session/get` | viewer | Return metadata and current state |
| `session/create` | controller | Create a session under an authorized project |
| `session/attach` | viewer | Establish a session role and return snapshot metadata |
| `events/subscribe` | viewer | Subscribe from a cursor or request a snapshot |
| `events/unsubscribe` | viewer | Remove a subscription |
| `events/ack` | viewer | Acknowledge the highest applied event sequence |
| `turn/start` | controller | Admit a turn and return immediately with `turnId` |
| `turn/get` | viewer | Return the current turn state |
| `turn/interrupt` | controller | Stop a turn at the next safe boundary; idempotent |
| `approval/respond` | approver | Resolve one live approval request |
| `input/respond` | controller | Resolve one live input request |
| `attachment/create` | controller | Reserve a bounded attachment slot |
| `attachment/complete` | controller | Verify an uploaded attachment hash and size |
| `session/revoke` | owner | Revoke a client or session membership |
| `session/archive` | owner | Archive an idle session |

The server MUST reject unknown operations with `METHOD_NOT_FOUND`. A client
MUST use capability discovery rather than assuming optional operations exist.

## 7. Core operation shapes

### 7.1 `session/attach`

Request:

```json
{
  "sessionId": "ses_01J...",
  "role": "controller",
  "afterSequence": 314,
  "includeSnapshot": true,
  "context": {
    "requestId": "req_attach_1"
  }
}
```

Response:

```json
{
  "session": { "id": "ses_01J...", "status": "idle", "revision": 22 },
  "role": "controller",
  "snapshot": {
    "lastSequence": 314,
    "snapshotRevision": 22,
    "items": []
  }
}
```

If `afterSequence` is older than the retained cursor, the response MUST set
`replay.complete` to `false` and include a current snapshot. The client MUST
not present the result as a continuous replay.

### 7.2 `events/subscribe`

Request:

```json
{
  "sessionId": "ses_01J...",
  "afterSequence": 314,
  "includeSnapshot": false,
  "context": { "requestId": "req_events_1" }
}
```

Response:

```json
{
  "subscriptionId": "sub_01J...",
  "sessionId": "ses_01J...",
  "startingSequence": 315,
  "replayComplete": true
}
```

The WebSocket server then sends `session/event` notifications. The HTTP server
returns an SSE stream whose `id` is the decimal `sequence` and whose `data` is
the `EventEnvelope`. A client MUST treat an SSE `Last-Event-ID` as
`afterSequence` on reconnect.

### 7.3 `turn/start`

Request:

```json
{
  "sessionId": "ses_01J...",
  "idempotencyKey": "turn-client-7f9c",
  "input": {
    "text": "Inspect the failing test and propose a fix.",
    "attachments": []
  },
  "context": {
    "requestId": "req_turn_1",
    "expectedRevision": 22
  }
}
```

Response:

```json
{
  "accepted": true,
  "turn": {
    "id": "turn_01J...",
    "sessionId": "ses_01J...",
    "status": "queued",
    "clientRequestId": "turn-client-7f9c"
  },
  "eventCursor": 315
}
```

The response is an admission result, not the final model response. Repeating
the same request with the same principal and idempotency key returns the same
turn. Reusing the key with different input returns `IDEMPOTENCY_CONFLICT`.

### 7.4 `turn/interrupt`

Request:

```json
{
  "turnId": "turn_01J...",
  "reason": "user_requested",
  "context": {
    "requestId": "req_interrupt_1",
    "idempotencyKey": "interrupt-turn_01J..."
  }
}
```

The response reports the current turn state. A late interrupt after a terminal
event is a successful no-op. Interrupt never rewinds a persisted transcript.

## 8. Event replay and backpressure

The Host MUST retain enough events to cover the configured replay window. The
initial target is:

- 10,000 events per session or 24 hours, whichever comes first;
- eight subscriptions per session per principal;
- sixteen connected clients per Agent Host;
- one megabyte maximum encoded event/frame;
- a bounded per-connection send queue.

The Host MAY evict old events after the limit. Eviction MUST make the cursor
invalid and cause `resync.required`, never silent loss.

WebSocket clients SHOULD send `events/ack` with the highest applied sequence.
The Host MAY use the acknowledgment to release transport buffers, but it MUST
not delete durable session state solely because a client acknowledged an event.

When a client is too slow for the send queue, the Host MUST close the
subscription or connection with `CLIENT_TOO_SLOW` and include the last safely
queued sequence. The client reconnects with that sequence.

## 9. Server-initiated approval and input

### 9.1 WebSocket

The Host sends:

```json
{
  "jsonrpc": "2.0",
  "id": "server-request-42",
  "method": "approval/request",
  "params": {
    "approval": {
      "id": "approval_01J...",
      "sessionId": "ses_01J...",
      "turnId": "turn_01J...",
      "kind": "tool",
      "summary": "Run the selected shell command",
      "expiresAt": "2026-09-09T12:00:00.000Z",
      "allowedDecisions": ["approve", "reject", "cancel"]
    }
  }
}
```

The client responds to the same JSON-RPC id. The Host then emits
`approval.resolved`, and the client may also call `approval/respond` when the
UI handles the request through a separate controller connection.

### 9.2 HTTP/SSE

The Host emits an `approval.requested` SSE event. The client calls:

```text
POST /v1/approvals/{approvalId}:respond
```

with `decision`, `expectedRevision`, and an idempotency key. Closing the SSE
stream does not approve, reject, or cancel the approval.

Only the Host may move the approval to a terminal state. Expiry, stale session
revision, an unknown approval id, or a decision outside
`allowedDecisions` fails closed.

## 10. Attachments

Small text and image inputs MAY be embedded in `turn/start` when their encoded
request remains below `maxPromptBytes`. Larger inputs use this flow:

1. `attachment/create` returns an opaque attachment id and an upload target.
2. The client uploads bytes over an authenticated HTTPS request.
3. `attachment/complete` supplies size and SHA-256.
4. The Host verifies the bytes, stores them in session-scoped scratch or
   attachment storage, and marks the attachment `ready`.
5. `turn/start` references only the ready attachment id.

Upload targets MUST be single-purpose, size-bounded, short-lived, and scoped to
one principal and session. A remote path, `file://` URL, or arbitrary URL MUST
not be accepted as a substitute for an upload.

## 11. Transport mappings

### 11.1 WebSocket JSON-RPC

- Endpoint: `wss://<authority>/v1/racp/ws`
- Subprotocol: `pi-racp.v1.jsonrpc`
- One UTF-8 JSON-RPC message per text frame
- Full-duplex server requests enabled
- Authentication uses the HTTP upgrade request; credentials are never put in
  the URL query string
- Ping/pong heartbeat target: 30 seconds

### 11.2 HTTP/JSON + SSE

| Operation family | HTTP mapping |
|---|---|
| Capabilities | `GET /v1/capabilities` |
| List sessions | `GET /v1/sessions` |
| Create session | `POST /v1/sessions` |
| Get/attach session | `GET /v1/sessions/{sessionId}` / `POST ...:attach` |
| Start turn | `POST /v1/sessions/{sessionId}/turns` |
| Get turn | `GET /v1/turns/{turnId}` |
| Interrupt turn | `POST /v1/turns/{turnId}:interrupt` |
| Event stream | `GET /v1/sessions/{sessionId}/events` |
| Resolve approval | `POST /v1/approvals/{approvalId}:respond` |
| Resolve input | `POST /v1/inputs/{inputId}:respond` |

The event endpoint MUST support `Last-Event-ID`. Commands return JSON and
never require the caller to keep a request open for turn execution.

### 11.3 gRPC

The gRPC binding uses the same semantic resources. The target service shape is:

```proto
service RemoteAgentControl {
  rpc GetCapabilities(GetCapabilitiesRequest) returns (Capabilities);
  rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);
  rpc GetSession(GetSessionRequest) returns (Session);
  rpc CreateSession(CreateSessionRequest) returns (Session);
  rpc StartTurn(StartTurnRequest) returns (TurnAccepted);
  rpc GetTurn(GetTurnRequest) returns (Turn);
  rpc InterruptTurn(InterruptTurnRequest) returns (Turn);
  rpc SubscribeEvents(SubscribeEventsRequest) returns (stream EventEnvelope);
  rpc ResolveApproval(ResolveApprovalRequest) returns (ApprovalResult);
  rpc ResolveInput(ResolveInputRequest) returns (InputResult);
}
```

`SubscribeEvents` is a server stream, not a long-running `StartTurn` call.
Authentication, principal, idempotency, cursor, and error semantics MUST map
to gRPC metadata/status without changing their meaning. The JSON shapes in
§5 are the binding-neutral normative model; a generated `.proto` schema MUST
preserve those fields and enums without inventing a second semantic contract.
Generated clients MUST not be handwritten per binding.

## 12. Limits and deadlines

The initial target limits are:

| Limit | Target |
|---|---:|
| JSON/gRPC request or event | 1 MiB |
| Prompt payload | 256 KiB |
| Attachment | 50 MiB |
| Session event replay | 10,000 events or 24 hours |
| Concurrent subscriptions per connection | 8 |
| Connected clients per Agent Host | 16 |
| `connection/initialize` deadline | 10 seconds |
| Read/metadata operation deadline | 15 seconds |
| `turn/start` admission deadline | 5 seconds |
| Approval lifetime | Host policy; never extended by disconnect |
| Heartbeat interval | 30 seconds |

The Host MAY advertise stricter limits. It MUST return a structured limit
error rather than truncating a command silently.

## 13. Errors

Every failed operation returns a JSON-RPC error, HTTP status, or gRPC status
with this semantic payload:

```ts
type RemoteError = {
  code: string
  message: string
  retriable: boolean
  traceId: string
  details?: unknown
}
```

Initial RACP codes are:

| Code | Retriable | Meaning |
|---|---:|---|
| `UNAUTHORIZED` | no | Missing, expired, or invalid credential |
| `FORBIDDEN` | no | Principal lacks the operation or session scope |
| `PROTOCOL_MISMATCH` | no | Unsupported major version or required capability |
| `INVALID_ARGUMENT` | no | Request schema or field value invalid |
| `NOT_FOUND` | no | Session, turn, approval, input, or attachment missing |
| `AGENT_UNAVAILABLE` | yes | Host or runtime is offline |
| `AGENT_BUSY` | no | Session cannot accept another turn |
| `CONFLICT` | yes | Expected revision or control lease is stale |
| `IDEMPOTENCY_CONFLICT` | no | Same key was reused with different input |
| `CURSOR_EXPIRED` | no | Replay window no longer contains the cursor |
| `CLIENT_TOO_SLOW` | yes | Bounded event queue was exceeded |
| `APPROVAL_EXPIRED` | no | Approval is no longer executable |
| `APPROVAL_STALE` | no | Approval response targets an old revision |
| `PAYLOAD_TOO_LARGE` | no | Request, event, or attachment exceeds a limit |
| `RATE_LIMITED` | yes | Principal, session, or host quota exceeded |
| `INTERNAL` | maybe | Unexpected failure with a trace id |

Implementations MUST map these codes into the shared `AppError` vocabulary
before adding them to production code. The same error code MUST mean the same
thing across all bindings.

## 14. Compatibility and conformance

1. New fields are additive. Existing field numbers and enum meanings are never
   reused.
2. Clients ignore unknown response fields and preserve unknown event kinds for
   diagnostics.
3. A server advertises optional capabilities before a client uses them.
4. A server never changes a terminal turn or approval back to an active state.
5. A binding conformance suite runs the same command/event trace through
   WebSocket, HTTP/SSE, and gRPC adapters.
6. Conformance covers duplicate mutations, cursor replay, cursor expiry,
   approval expiry, slow clients, authorization, attachment hashes, and host
   restart recovery.
7. The client treats a new major protocol version as incompatible unless an
   explicit compatibility adapter is selected.
