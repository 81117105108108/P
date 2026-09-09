# Remote Agent Control Rollout and Acceptance

- Status: Target delivery specification; post-MVP
- Decision: D373 / ADR 0205
- Normative protocol: `03-runtime/19-remote-agent-control-protocol.md`
- Normative security: `05-security/02-remote-control-security.md`

## 1. Delivery boundary

Remote control is a post-MVP capability. The current MVP continues to ship:

- Electron Main as the local orchestrator;
- Node pi sidecar as the Agent runtime;
- Rust host-core over local stdio NDJSON JSON-RPC;
- optional loopback-only MCP control under ADR 0203; and
- no public or LAN Gateway listener.

Remote work MUST NOT begin by exposing the existing host-core or IPC endpoint.
The implementation starts with a typed facade and conformance tests, then adds
transport bindings behind explicit feature flags.

## 2. Milestones

### R0 — Contract and test fixtures

Deliver:

- RACP v1 resource and operation definitions;
- shared request/response/event fixtures;
- error mapping and capability negotiation fixtures;
- cursor, snapshot, idempotency, and approval state-machine tests;
- binding-independent authorization test vectors; and
- threat model review against the security specification.

Exit criteria:

1. A fixture trace has an identical semantic result for every supported
   binding.
2. Duplicate, stale, expired, and unauthorized requests have deterministic
   outcomes.
3. No fixture requires direct host-core or renderer access.

### R1 — Local Agent Host facade

Deliver a `RemoteAgentControlFacade` above the existing Electron Main handlers.
The facade is reachable only through a loopback test endpoint or an explicit
development tunnel. It must:

- attach to current sessions;
- return snapshots and ordered events;
- admit asynchronous turns;
- route approval/input requests; and
- preserve existing local permission and persistence behavior.

Exit criteria:

1. A client can close and reopen without interrupting a turn.
2. A stale event cursor results in a snapshot, not an invented event sequence.
3. Existing local renderer behavior and the local MCP control plane are
   unchanged.

### R2 — Primary WebSocket binding

Deliver `RACP-WS` over WSS for native clients and interactive browser control.
Add authentication, per-connection limits, server requests, heartbeats,
bounded event queues, and revocation.

Exit criteria:

- E2E-221 through E2E-226 pass in an isolated remote harness;
- a slow client cannot stall or exhaust the Host;
- an authenticated second viewer receives the same event sequence; and
- approval decisions are bound to principal, Session, turn, and revision.

### R3 — Gateway and outbound Host link

Deliver a separate Remote Gateway and a standalone Agent Host mode. The Host
opens the outbound WSS or gRPC link and the Gateway performs identity,
routing, rate limits, audit, and revocation.

Exit criteria:

1. A Host behind inbound firewall/NAT can connect without an open desktop
   listener.
2. A Gateway restart does not lose a local turn or duplicate a mutation.
3. Revoking a Host or user closes active connections and blocks new commands.
4. Gateway storage contains no provider secrets or unredacted transcript data.

### R4 — HTTP/SSE browser binding

Deliver `RACP-HTTP` for browser clients and simple integrations. Commands are
short HTTP requests; events use SSE and `Last-Event-ID`. Approval and input
responses use explicit POST endpoints.

Exit criteria:

- browser reconnect after a network switch replays or resynchronizes;
- Origin, CORS, CSRF, and bearer handling pass security tests;
- HTTP binding results match the WebSocket fixture traces; and
- no command waits for the entire Agent turn.

### R5 — gRPC service binding

Deliver `RACP-GRPC` for Gateway-to-Host and native service clients after the
semantic model has stabilized. Generate clients from the normative Protobuf
schema; do not maintain an independent hand-written gRPC contract.

Exit criteria:

- unary commands and server-stream event subscriptions pass binding parity;
- deadlines, cancellation, metadata, and status preserve RACP semantics;
- a gRPC client can resume from a cursor after stream failure; and
- long-lived stream behavior has explicit load-balancer and connection-health
  tests.

## 3. Implementation rules

### 3.1 Preserve the local path

The first remote facade calls the same registered Main handlers used by the
renderer. It does not call the renderer, `host.proxy`, or Rust host-core from a
network listener. The standalone Host later moves that facade beside the
existing sidecars without changing RACP.

### 3.2 Keep the Agent independent of clients

The Host owns active turns and event cursors. Client lifetime, browser tab
lifetime, and Electron window visibility do not control Agent execution. A
client must explicitly call `turn/interrupt` to stop a turn.

### 3.3 Make replay a first-class test surface

Every event-producing test records:

- the initial snapshot revision and sequence;
- the exact command and idempotency key;
- every event sequence applied;
- the disconnect point;
- the replay request; and
- the final snapshot hash.

The test fails if a duplicate, gap, out-of-order event, or unannounced state
change appears.

### 3.4 Keep bindings semantically equal

The conformance fixture is the source of truth for behavior. Each binding may
choose its native status and serialization, but it must preserve:

- operation acceptance and rejection;
- authorization scope;
- idempotency result;
- event order and cursor;
- approval lifecycle;
- attachment hash and size checks; and
- terminal turn state.

## 4. Validation plan

### 4.1 Unit and contract validation

- schema validation for every request, response, and event;
- state-machine transition tests for Session, Turn, Approval, and Attachment;
- idempotency tests with lost response and retry;
- cursor replay, expiry, gap, and snapshot tests;
- authorization matrix tests for every role and operation;
- redaction tests for prompts, tool data, credentials, and attachments; and
- generated binding round-trip tests.

### 4.2 Integration validation

- Electron Main facade with the real sidecar and host-core supervision;
- standalone Host with a real workspace fixture;
- Gateway routing across at least two Hosts and two tenants;
- browser WSS and SSE reconnect across a network interruption;
- outbound Host connection through a firewall/NAT test harness;
- host restart while a turn is running; and
- Gateway restart while a Host turn is running.

### 4.3 Security validation

- invalid, expired, revoked, and wrong-tenant tokens;
- wrong role, wrong Session, wrong Host, and stale revision;
- Origin, CORS, CSRF, and WebSocket upgrade checks;
- SSRF and arbitrary file/path attempts;
- oversized and hash-mismatched uploads;
- prompt-injected requests attempting to select secrets or permissions;
- slow-reader and connection-exhaustion tests; and
- audit-log redaction and retention checks.

### 4.4 Operational validation

Record at minimum:

- turn admission latency;
- event delivery latency and sequence lag;
- replay and resync counts;
- approval wait time and expiry count;
- Host/Gateway connection health;
- authentication and authorization failures;
- event queue drops; and
- active Host/Session/client counts.

The first production target is a bounded, observable remote control service,
not an unbounded real-time stream. Load tests must demonstrate that a slow or
disconnected client does not affect local Agent execution.

## 5. Rollout and rollback

1. Ship protocol fixtures and disabled code paths first.
2. Enable R1 only in development profiles.
3. Enable RACP-WS for allowlisted test users and Hosts.
4. Add Gateway routing only after Host identity and revocation pass review.
5. Add browser SSE and gRPC as independent capabilities.
6. Keep a kill switch that rejects new remote connections while preserving
   already-running local desktop sessions.

Rollback MUST:

- stop accepting new remote connections;
- revoke or drain active remote connections according to incident policy;
- leave local stdio, renderer, and MCP paths usable;
- preserve completed local transcript data; and
- never replay a turn merely because a remote feature flag changed.

## 6. Release acceptance

The feature is not production-ready until:

1. all remote scenarios E2E-221 through E2E-230 are green in the approved
   remote harness;
2. the security acceptance gates in
   `05-security/02-remote-control-security.md` are signed off;
3. WebSocket, HTTP/SSE, and gRPC binding parity is demonstrated;
4. a failure-injection run proves no duplicate execution after reconnect;
5. the Gateway and Host operational dashboards are available; and
6. a new release/rollback runbook names the feature flag, revocation path,
   data retention, and incident owner.
