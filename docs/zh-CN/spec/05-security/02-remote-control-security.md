# 远程 Agent 控制安全规格

- 状态：目标规格，属于 MVP 之后
- 决策：D373 / ADR 0205
- 英文源规格：[英文源规格](/spec/05-security/02-remote-control-security)

## 1. 安全目标

远程控制必须提供身份认证、会话级授权、TLS、撤销、审计、资源上限和
无重放保证。prompt、tool result、附件和模型输出均是不可信数据，不能
凭自身内容提升权限。

```text
Remote Client ── HTTPS/WSS ── Gateway
                                  │ outbound mTLS
                                  ▼
                             Agent Host
                             ├── pi sidecar
                             └── Rust host-core
```

## 2. 信任区

| Zone | Trust assumption | Required boundary |
|---|---|---|
| Remote Client | 已认证但 UI 和 prompt 不可信 | 有范围 bearer/OIDC token，不默认给 secret 权限 |
| Gateway | 受信产品服务，但暴露在网络边界 | auth、授权、限流、审计，不访问 raw host RPC |
| Agent Host | 工作区旁的本地权威 | mTLS/device identity、签名能力、Host policy |
| Node sidecar | Agent runtime，不拥有 policy | Main/Host proxy allowlist |
| Rust host-core | 工作区、存储、工具、secret 权威 | 仅 stdio，无公网监听 |

```ts
type HostRouteContext = { tenantId: string; hostId: string; subject: string; sessionScopes: string[]; roles: string[]; expiresAt: string }
```

## 3. 身份、授权与边界

生产 Gateway 使用 OIDC/OAuth 2.0；浏览器使用 Authorization Code + PKCE，
refresh token 不转发给 Host。Host 通过出站 mTLS 或等价 device credential
连接 Gateway；一次性 enrollment credential 必须短期、单次使用。

| Operation | Viewer | Controller | Approver | Owner |
|---|---:|---:|---:|---:|
| List/get/subscribe | yes | yes | yes | yes |
| Create/attach as viewer | yes | yes | yes | yes |
| Start a turn | no | yes | optional | yes |
| Interrupt a turn | no | yes | optional | yes |
| Resolve approval | no | no by default | yes | yes |
| Resolve Plan/Goal approval | no | no by default | explicit policy | yes |
| Upload attachment | no | yes | optional | yes |
| Revoke membership | no | no | no | yes |
| Archive session | no | no | no | yes |
| Provider secrets | no | no | no | no |

客户端不能通过字段指定 workspaceRoot、permissionMode、toolName、provider
secret 或其他 principal。所有工具继续走 Host 的 workspace、permission、
secret 和 approval 边界；不得暴露 `host.proxy`、raw IPC 或任意命令执行。

## 4. 网络、附件和多租户

公网 HTTP、SSE、WebSocket 和 gRPC 必须使用 TLS；生产 Host link 必须双向
认证。Origin、CORS、CSRF、WebSocket upgrade、token URL 和 SSRF 都要在
边界处校验。附件使用大小、hash、MIME 和过期时间校验，不能接受本地路径。

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

## 5. 审计、撤销和验收

审计记录包含 principal、tenant、Host、Session、Turn、operation、结果、
授权决定和序号范围，但默认不记录 provider secret、原始 prompt、tool
参数、tool 输出或附件字节。撤销用户、Host、连接、成员或附件后，新的
mutation 必须被拒绝，已完成回合不能因撤销而重放。

安全验收必须覆盖 TLS、跨租户隔离、角色矩阵、过期 token、重复 mutation、
游标回放、慢客户端、上传边界、日志脱敏和 Host/Gateway 重启。
