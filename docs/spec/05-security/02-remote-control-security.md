# Remote Agent Control Security Specification

- Status: Target specification; post-MVP
- Decision: D373 / ADR 0205
- Applies to: RACP-WS, RACP-HTTP, RACP-GRPC, and Gateway-to-Host links
- Does not weaken: local MCP, host-core, plugin, or provider-secret boundaries

## 1. Security goals

Remote control MUST provide:

1. authenticated user and device identity;
2. authorization scoped to tenant, Host, project, Session, operation, and role;
3. confidentiality and integrity in transit;
4. no direct network access to Rust host-core;
5. host-owned permission and workspace enforcement;
6. revocation and auditability;
7. bounded resource use and safe disconnect behavior; and
8. no replay of a completed or previously admitted mutation.

The security design assumes that an Agent can be prompt-injected. A prompt,
tool result, attachment, or model output is untrusted data and MUST NOT grant
an authority that the authenticated principal does not already have.

## 2. Trust zones

```text
┌──────────────────────┐       HTTPS/WSS        ┌─────────────────────┐
│ Remote Client        │ ──────────────────────▶ │ Remote Gateway      │
│ browser/native/CLI   │                         │ identity + routing  │
└──────────────────────┘                         └──────────┬──────────┘
                                                           │ outbound mTLS
                                                           ▼
                                               ┌─────────────────────────┐
                                               │ Agent Host               │
                                               │ session + policy owner   │
                                               ├──────────┬──────────────┤
                                               │ pi       │ Rust host    │
                                               │ sidecar  │ core         │
                                               └──────────┴──────────────┘
```

| Zone | Trust assumption | Required boundary |
|---|---|---|
| Remote Client | Authenticated but UI and prompt data are untrusted | Scoped bearer/OIDC token; no secret authority by default |
| Gateway | Trusted product service, but routable and exposed | Authn, authz, rate limits, audit, no raw host RPC |
| Agent Host | Trusted local authority beside the workspace | mTLS/device identity, signed capabilities, host policy |
| Node sidecar | Agent runtime, not policy owner | Main/Host proxy allowlist |
| Rust host-core | Workspace, storage, tool, and secret authority | stdio only; no public listener |

## 3. Identity and enrollment

### 3.1 Client to Gateway

The production Gateway MUST use an established user identity provider through
OIDC/OAuth 2.0. Browser clients use Authorization Code + PKCE. Native clients
use Authorization Code + PKCE or a product-approved device flow.

- Access tokens are sent in the `Authorization` header.
- Access tokens MUST NOT be placed in query strings, WebSocket URLs, SSE URLs,
  attachment names, or event payloads.
- Refresh tokens remain in the client identity boundary and are never forwarded
  to the Agent Host.
- The Gateway validates issuer, audience, signature, expiry, tenant, and
  revocation state before routing.
- A browser session MUST use an explicit Origin allowlist and CSRF protection
  for cookie-backed login flows. Bearer-only APIs still validate Origin for
  browser requests.

For the first trusted-device prototype, a one-time pairing code MAY bootstrap
the identity link. It MUST be short-lived, single-use, displayed out of band,
and exchanged over TLS. A pairing code MUST NOT become a long-lived API token.

### 3.2 Agent Host to Gateway

The Agent Host MUST open the production connection outbound. The target link
uses mutual TLS with a per-host identity certificate or an equivalent signed
device credential.

- Enrollment credentials are one-time and expire after the enrollment window.
- Host credentials are scoped to one tenant and Host identity.
- The Gateway rejects a certificate or device credential after revocation.
- Credentials rotate without exposing provider secrets to the Gateway.
- The Host rejects a Gateway connection whose server identity is not pinned to
  the configured product trust roots.
- The Host never accepts an unauthenticated inbound control socket.

Direct LAN or development connections still use TLS and an expiring device
token. Plain `ws://`, plain HTTP, and static shared tokens in URLs are not
supported.

### 3.3 Host capability context

After the Gateway authenticates a user, it issues a short-lived signed route
context containing:

```ts
type HostRouteContext = {
  tenantId: string
  hostId: string
  subject: string
  sessionScopes: string[]
  roles: string[]
  issuedAt: string
  expiresAt: string
  tokenId: string
}
```

The Agent Host verifies the signature, audience, Host id, expiry, and session
scope before executing any mutation. The Gateway's transport connection is not
itself authorization for a session.

## 4. Authorization model

### 4.1 Role matrix

| Operation | Viewer | Controller | Approver | Owner |
|---|---:|---:|---:|---:|
| List/get visible sessions | yes | yes | yes | yes |
| Subscribe to events | yes | yes | yes | yes |
| Create/attach as viewer | yes | yes | yes | yes |
| Start a turn | no | yes | optional | yes |
| Interrupt own/session turn | no | yes | optional | yes |
| Resolve tool approval | no | no by default | yes | yes |
| Resolve Plan/Goal approval | no | no by default | explicit policy | yes |
| Upload an attachment | no | yes | optional | yes |
| Revoke membership | no | no | no | yes |
| Archive a session | no | no | no | yes |

Role checks are necessary but not sufficient. The Host MUST additionally check:

- the Session belongs to the requested tenant and Host;
- the principal is allowed to use the Session's project;
- the operation is legal in the Session state;
- the durable permission/mode policy allows the proposed action; and
- the request's expected revision and idempotency key are valid.

### 4.2 No privilege escalation through protocol fields

The following client fields are advisory only or forbidden:

- `permissionMode` cannot upgrade a durable Session policy;
- `workspaceRoot` cannot replace a Host-owned project binding;
- `toolName` cannot select a tool outside the Host catalog;
- `confirm` cannot replace an approval request or create an approval result;
- `providerApiKey`, secret values, and secret references cannot be supplied in
  a turn payload; and
- a client cannot claim another `principal`, `agentName`, or `connectionId`.

The Host chooses the effective model/provider configuration from its own
session and provider state. Remote control does not become a credential relay.

## 5. Network and transport protections

### 5.1 TLS

- Public HTTP, SSE, WebSocket, and gRPC endpoints MUST use TLS 1.2 or newer;
  TLS 1.3 is preferred.
- Production Host links MUST use mutual TLS or an equivalent device-bound
  authenticated channel.
- Certificate validation MUST include hostname or service identity validation;
  disabling verification is not a development shortcut supported by the
  product.
- WebSocket upgrade credentials are validated before accepting the connection.

### 5.2 Origin and cross-site controls

- The Gateway maintains an explicit browser Origin allowlist per tenant.
- Local-only endpoints bind loopback and validate loopback Origin as required
  by ADR 0203.
- Cookie-backed browser sessions use SameSite protection and CSRF tokens.
- A bearer token in a URL is always rejected.
- CORS exposes only the required methods, headers, and response types.

### 5.3 Request binding and replay protection

Every mutation carries a principal-bound idempotency key. The Host stores the
key and result for at least the active turn lifetime and rejects reuse with
different payload bytes. A Gateway retry MUST preserve the key and trace
context.

Requests with an expired route context, stale session revision, or revoked
connection fail before they reach the Agent runtime.

## 6. Workspace, file, and attachment security

1. A remote request identifies a Session, not an arbitrary filesystem root.
2. The Host resolves every tool path against that Session's durable project or
   scratch root.
3. Remote clients send attachment bytes or opaque attachment ids, never local
   absolute paths or `file://` URLs.
4. The Host validates declared size, actual size, MIME policy, SHA-256, and
   expiration before a turn can reference an attachment.
5. Attachment storage is private to the owning tenant, Host, and Session.
6. Uploads are not executable and are not automatically added to a tool root.
7. Gateway URL fetches are not accepted as an attachment source, preventing
   SSRF through a remote-control request.
8. Workspace reads and writes continue to use the current host sandbox,
   ignore rules, path checks, and permission policy.

## 7. Tool and approval security

Remote control MUST use the existing host-owned tool execution path. It MUST
NOT expose:

- raw `host.proxy` calls;
- raw Rust host-core methods;
- generic Electron IPC invocation;
- provider secret get/set/delete methods;
- arbitrary process spawning; or
- a remote equivalent of a disabled permission mode.

Approval requests contain a bounded, redacted summary. The client submits a
decision for a live request; it does not submit a tool invocation to be
executed after approval. The Host verifies request id, Session id, turn id,
principal role, expiry, allowed decision, and current state in one operation.

An approval response that arrives after disconnect, expiry, abort, crash, or
turn completion is a no-op or a structured stale/expired error. It never
restarts the turn.

## 8. Gateway and tenant isolation

- Every route is keyed by `(tenantId, hostId, sessionId)`.
- A client cannot enumerate Host or Session ids outside its signed scope.
- Gateway caches contain opaque ids and routing metadata, not provider secrets.
- A Host reconnect replaces the old connection only after identity and tenant
  match; stale links are closed.
- A tenant's rate limits and event queues are independent of other tenants.
- Logs and metrics carry tenant/host/session identifiers only where the
  retention policy permits; prompt and tool content is excluded by default.

## 9. Abuse controls and resource bounds

The Gateway and Host enforce the lower of their configured limits:

| Resource | Initial target |
|---|---:|
| Control requests per principal | 120/minute |
| Turn starts per Session | 20/minute |
| Concurrent clients per Host | 16 |
| Concurrent subscriptions per connection | 8 |
| Request/event frame | 1 MiB |
| Prompt payload | 256 KiB |
| Attachment | 50 MiB |
| In-flight attachment uploads per principal | 4 |
| Event send queue | 4 MiB or 1,000 events |

Rate-limit responses include a retry hint but never disclose another tenant's
quota. Slow clients are disconnected with a resumable cursor. The Host never
blocks the Agent turn indefinitely on a remote client that stopped reading.

## 10. Audit and observability

Every remote control mutation produces a structured audit record containing:

- `traceId`, `connectionId`, `principal`, `tenantId`, `hostId`;
- Session and turn ids;
- operation and outcome;
- authorization decision and role;
- idempotency key hash, not the raw key;
- event sequence range, when applicable; and
- error code or approval decision.

Audit records MUST NOT contain provider credentials, raw prompt text, raw tool
arguments, raw tool output, attachment bytes, or approval secrets by default.
The runtime logger may record bounded redacted summaries under the existing
redaction policy.

Metrics SHOULD cover connection count, reconnects, authentication failures,
authorization failures, event lag, replay/resync counts, turn admission
latency, approval latency, queue drops, and Host availability.

Trace propagation uses W3C `traceparent` where the selected transport supports
it. A Gateway MUST preserve the trace id across the Host link.

## 11. Revocation and incident response

The Gateway MUST be able to revoke:

- a user session;
- a Host device;
- a client connection;
- a Session membership; and
- a pending attachment or upload target.

Revocation closes active connections, prevents new mutations, and leaves the
Agent Host's local turn policy unchanged. A running turn is interrupted only
when the revoked scope or incident policy explicitly requires it; revocation
must not silently replay or roll back a completed turn.

Provider credential rotation remains an Agent Host operation. Remote clients
cannot use the control protocol to export, test, or replace a secret unless a
separate, explicitly specified credential-management capability is added.

## 12. Security acceptance gates

1. Plain HTTP and `ws://` are rejected outside an explicitly isolated local
   test harness.
2. Rust host-core has no public listener and cannot be addressed by a remote
   client.
3. A viewer cannot start a turn or resolve an approval.
4. A controller cannot select an unauthorized Session, workspace, tool, model,
   permission mode, or provider secret.
5. A prompt-injected tool result cannot change the authenticated principal or
   role.
6. Duplicate mutation keys cannot create duplicate turns or approvals.
7. An expired/revoked credential cannot resume a connection or upload bytes.
8. Cross-tenant Host, Session, event, attachment, and audit access is denied.
9. Event replay never crosses a Session or principal scope.
10. Gateway and Host logs contain no provider secrets or unredacted tool data.
11. Slow clients cannot exhaust Host memory or stall an Agent turn.
12. Host crash, Gateway reconnect, and client reconnect do not replay an
    already-admitted execution.
