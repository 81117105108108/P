# 19. 远程 Agent 控制协议

- 协议：`PI Remote Agent Control Protocol`（`RACP`）
- 版本：`1.0`
- 状态：目标规格，属于 MVP 之后
- 英文源规格：[英文源规格](/spec/03-runtime/19-remote-agent-control-protocol)

英文页面是规范源。本页保留协议字段、方法名、错误码和代码结构，便于
中文读者检索；实现必须以英文规范中的完整定义为准。

## 1. 边界与术语

RACP 控制 Agent Host，不是 Electron IPC、`host.proxy`、Rust host-core
协议、provider proxy、本地 MCP 或子代理 A2A/Peer 协议。

| Term | Meaning |
|---|---|
| Host | 拥有会话并执行回合的 Agent Host |
| Client | 控制 Host 的 UI、CLI、原生应用或服务 |
| Gateway | 可选的认证路由层 |
| Session | 持久化会话及工作区/项目绑定 |
| Turn | 一次 prompt 及其模型/工具生命周期 |
| Item | 回合中的消息、工具调用等单位 |
| Event | 会话的有序状态或进度通知 |
| Cursor | 会话范围内的事件序列位置 |
| Principal | 认证后的用户、设备、服务或 Gateway 身份 |
| Binding | RACP 操作的传输编码 |

## 2. 初始化和消息

连接必须先发送 `connection/initialize`，完成响应和
`notifications/initialized` 后才能使用其他方法。JSON-RPC over WSS
每帧一个 UTF-8 消息；HTTP/SSE 使用 POST 命令和带 `Last-Event-ID` 的事件流。
HTTP 绑定把每个操作映射为一个等价的 HTTP/JSON 操作请求体，不要求 JSON-RPC
外层 envelope；响应是领域对象。请求上下文可通过请求体以及可用时的
`X-Request-Id`、`Idempotency-Key` 和 `If-Match-Revision` 请求头传递。

```json
{"jsonrpc":"2.0","id":"init-1","method":"connection/initialize"}
```

```json
{"protocolVersion":"1.0","bindings":["RACP-WS","RACP-HTTP"]}
```

```ts
type RequestContext = { requestId: string; idempotencyKey?: string; expectedRevision?: number }
```

```ts
type Session = { id: string; mode: "agent" | "plan" | "goal"; revision: number }
```

```ts
type Turn = { id: string; sessionId: string; status: "queued" | "running" | "completed" }
```

```ts
type EventEnvelope = { sessionId: string; sequence: number; stateRevision: number; kind: string; payload: unknown }
```

```ts
type SessionSnapshot = { session: Session; lastSequence: number; snapshotRevision: number }
```

```ts
type ApprovalRequest = { id: string; turnId: string; expiresAt: string; allowedDecisions: string[] }
```

```ts
type InputRequest = { id: string; turnId: string; prompt: string; expiresAt: string }
```

```ts
type Attachment = { id: string; sizeBytes: number; sha256: string; status: string }
```

```json
{"sessionId":"ses_01J","role":"controller","afterSequence":314}
```

```json
{"session":{"id":"ses_01J"},"snapshot":{"lastSequence":314}}
```

```json
{"sessionId":"ses_01J","afterSequence":314,"includeSnapshot":false}
```

```json
{"subscriptionId":"sub_01J","startingSequence":315}
```

```json
{"sessionId":"ses_01J","idempotencyKey":"turn-client-7f9c","input":{"text":"Inspect the test."}}
```

```json
{"accepted":true,"turn":{"id":"turn_01J","status":"queued"}}
```

```json
{"turnId":"turn_01J","reason":"user_requested"}
```

```json
{"jsonrpc":"2.0","id":"server-request-42","method":"approval/request"}
```

```text
GET /v1/sessions/{sessionId}/events\nLast-Event-ID: 314
```

```proto
service RemoteAgentControl { rpc StartTurn(StartTurnRequest) returns (TurnAccepted); rpc SubscribeEvents(SubscribeEventsRequest) returns (stream EventEnvelope); }
```

## 3. 资源和操作

会话由 Host 持久化并拥有 revision；回合是异步执行单位；事件使用每会话
递增且不复用的 `sequence`；附件只能通过受校验的 opaque id 引用。

| Operation | Role | Behavior |
|---|---|---|
| `connection/initialize` | authenticated | 协商协议和能力 |
| `connection/ping` | authenticated | 返回连接健康和服务器时间 |
| `session/list` | viewer | 列出主体可见会话 |
| `session/get` | viewer | 返回会话元数据和状态 |
| `session/create` | controller | 在授权项目下创建会话 |
| `session/attach` | viewer | 建立会话角色并返回快照信息 |
| `events/subscribe` | viewer | 按游标订阅或请求快照 |
| `events/unsubscribe` | viewer | 移除订阅 |
| `events/ack` | viewer | 确认已应用的最高序号 |
| `turn/start` | controller | 快速准入并返回 `turnId` |
| `turn/get` | viewer | 返回回合状态 |
| `turn/interrupt` | controller | 在安全边界中断回合，幂等 |
| `approval/respond` | approver | 解决活动审批请求 |
| `input/respond` | controller | 解决活动输入请求 |
| `attachment/create` | controller | 预留有界附件槽位 |
| `attachment/complete` | controller | 校验附件 hash 和大小 |
| `session/revoke` | owner | 撤销客户端或会话成员资格 |
| `session/archive` | owner | 归档空闲会话 |

## 4. 游标、审批和附件

客户端重连时发送 `afterSequence`。游标仍在窗口内则回放，过期则返回
`resync.required` 和完整快照，不能猜测丢失事件。审批和输入请求均绑定
Session、Turn、principal、revision 和过期时间。

大附件使用 `attachment/create`、HTTPS 上传和 `attachment/complete`；
远程本地路径、`file://` 和任意 URL 都不允许作为附件来源。

## 5. 传输映射

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

WebSocket 是交互主绑定，HTTP/SSE 是浏览器绑定，gRPC 使用 unary 命令和
server-stream 事件。三种绑定必须通过同一套语义一致性测试。

## 6. 限制和错误

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
| Approval lifetime | Host policy |
| Heartbeat interval | 30 seconds |

| Code | Retriable | Meaning |
|---|---:|---|
| `UNAUTHORIZED` | no | 凭据缺失、过期或无效 |
| `FORBIDDEN` | no | 主体没有操作或会话范围 |
| `PROTOCOL_MISMATCH` | no | 协议主版本或能力不支持 |
| `INVALID_ARGUMENT` | no | 请求结构或字段无效 |
| `NOT_FOUND` | no | 会话、回合、审批、输入或附件不存在 |
| `AGENT_UNAVAILABLE` | yes | Host 或 runtime 离线 |
| `AGENT_BUSY` | no | 会话不能接受新回合 |
| `CONFLICT` | yes | revision 或控制租约过期 |
| `IDEMPOTENCY_CONFLICT` | no | 同一 key 使用了不同输入 |
| `CURSOR_EXPIRED` | no | 游标不在回放窗口内 |
| `CLIENT_TOO_SLOW` | yes | 有界事件队列溢出 |
| `APPROVAL_EXPIRED` | no | 审批已不可执行 |
| `APPROVAL_STALE` | no | 审批响应针对旧 revision |
| `PAYLOAD_TOO_LARGE` | no | 请求、事件或附件超限 |
| `RATE_LIMITED` | yes | 主体、会话或 Host 超额 |
| `INTERNAL` | maybe | 带 trace id 的内部错误 |

错误必须同时携带稳定 code、可重试标记和 trace id。重复 mutation 使用同一
idempotency key 时返回原结果；使用相同 key 发送不同输入则失败。

## 7. 兼容性

新增字段只能追加，不能复用已有字段含义。可选能力必须通过初始化协商。
终止状态不能回到活动状态；任一 binding 的行为都必须通过相同 fixture
验证。完整状态机、示例和验收条款见英文源规格。
