# 远程 Agent 控制安全规格

- 状态：目标规格，属于 MVP 之后
- 决策：D373 / ADR 0205，经 D376 与 D377 修订
- 英文源规格：[英文源规格](/spec/05-security/02-remote-control-security)

## 1. 安全目标

远程控制必须提供身份认证、会话级授权、TLS、撤销、审计、资源上限、
无重放保证，以及远程权限上限，使远程 controller 无法把会话变成无人值守
执行。prompt、tool result、附件和模型输出均是不可信数据，不能凭自身内容
提升权限。

```text
Remote Client ── HTTPS/WSS ── Gateway
                                  │ outbound mTLS Host link
                                  ▼
                             Agent Host
                             ├── pi sidecar
                             └── Rust host-core
```

## 2. 信任区

| Zone | Trust assumption | Required boundary |
|---|---|---|
| Remote Client | 已认证但 UI 和 prompt 不可信 | 有范围的 session 或 bearer 凭据，不默认给 secret 权限 |
| Gateway | 受信产品服务，但暴露在网络边界 | auth、授权、限流、审计、仅瞬态缓冲，不访问 raw host RPC |
| Agent Host | 工作区旁的本地权威 | mTLS/device identity、签名 route context、Host policy、远程权限上限 |
| Node sidecar | Agent runtime，不拥有 policy | Main/Host proxy allowlist |
| Rust host-core | 工作区、存储、工具、权限、secret 权威 | 仅 stdio，无公网监听 |

```ts
type HostRouteContext = { tenantId: string; hostId: string; subject: string; clientConnectionId: string; sessionScopes: string[]; roles: string[]; expiresAt: string }
```

## 3. 身份、授权与边界

Gateway 的身份源可以是 OIDC/OAuth 2.0 提供方，也可以是第一方产品账号服务
（Gateway 将其用户 token 作为第一方 JWT 校验），在 Gateway 里程碑排期时记录决定（D377）。
浏览器无法在 WebSocket/EventSource 上设置请求头，因此 Gateway 提供两种认证
profile：非浏览器客户端用 `Authorization` 头（header profile）；浏览器客户端用
HttpOnly、Secure、SameSite cookie + 按租户的 Origin 白名单 + 每次 mutation 的
CSRF token（cookie profile），也可改用带头部认证的 `fetch` 流式读取。两种
profile 都禁止把 token 放进 URL。Gateway 与 cookie profile 属于不排期的
Gateway 与浏览器里程碑（D377）；首个远程拓扑使用 header profile，设备 token
来自 SSH 引导配对。Host 通过出站 mTLS Host link 连接 Gateway，link 只认证
Gateway，用户权限只来自每个逻辑连接的签名 route context；一次性 enrollment
credential 必须短期、单次使用。

SSH 引导配对（首个远程拓扑）：桌面经用户自己的 SSH 会话在远端启动 `pi-host`，
SSH 登录已证明对该机器的 shell 访问，配对只是把一个桌面设备绑定到它启动的
Host。配对 token 由 Host 启动时生成，单次使用，在引导窗口内过期，只经 SSH 通道
传递，绝不写入可读文件或 URL；桌面在转发的 loopback 端口上用它一次性换取设备
token 并存入安全存储，Host 把该设备记为 `owner`。Host 只绑定 loopback，只接受
loopback 对端出示的设备 token；非 loopback 绑定要求 TLS 与同样的设备 token。
在 Host 上撤销设备 token 或在桌面移除该 Host 即结束配对，重新配对需要重新
经 SSH 引导。远端 Host 的 provider 配置由引导步骤经 SSH 通道写入为 Host 本地
配置，绝不经过 RACP。

| Operation | Viewer | Controller | Approver | Owner |
|---|---:|---:|---:|---:|
| List/get/subscribe/history | yes | yes | yes | yes |
| Create/attach as viewer | yes | yes | yes | yes |
| Start or queue a turn | no | yes | optional | yes |
| Stop/interrupt/cancel a turn | no | yes | optional | yes |
| Resolve tool approval (`allow-once`, `deny`) | no | no by default | yes | yes |
| Resolve tool approval with `allow-session` | no | no | policy | yes |
| Resolve Plan/Goal approval with permission mode | no | no by default | explicit policy | yes |
| Answer an input request | no | yes | optional | yes |
| Upload attachment | no | yes | optional | yes |
| Revoke membership | no | no | no | yes |
| Archive session | no | no | no | yes |
| Provider secrets | no | no | no | no |
| Raise the remote permission ceiling | no | no | no | no |

客户端不能通过字段指定 workspaceRoot、permissionMode（Plan/Goal `approve`
上的显式选择除外，且须在 `allowedPermissionModes` 内）、toolName、provider
secret 或其他 principal / clientConnectionId；`admission: "queue"` 只能进入有界、
可取消的 Host 队列。远程主体发起的回合运行在会话模式与 Host
`remoteMaxPermissionMode`（默认 `ask`，顺序 `ask` < `accept-edits` < `auto`）中
较低者之下，只有持有 `approver` 且策略允许时才可超出。上限只作用于经 Gateway
路由的主体：经 SSH 引导配对的桌面设备持有该 Host 的 `owner` 并豁免，因为 SSH
登录已授予该机器的 shell 访问，上限无可限制。`allow-session` 只在
Host 策略允许远程会话授权时出现在 `allowedDecisions` 中。所有工具继续走
Host 的 workspace、permission、secret 和 approval 边界；不得暴露 `host.proxy`、
raw IPC 或任意命令执行。

## 4. 网络、附件和多租户

公网 HTTP、SSE 和 WebSocket 必须使用 TLS，保留的 gRPC 同样适用；绑定 loopback
并经 SSH 端口转发访问的 `pi-host`，在绑定地址与对端地址都是 loopback 且出示
有效设备 token 时可接受明文 `ws://`，SSH 通道提供机密性，与 ADR 0203 的 loopback
规则一致，任何非 loopback 绑定都要求 TLS；生产 Host link 必须双向认证。Origin、CORS、CSRF、cookie、WebSocket upgrade、token URL 和
SSRF 都要在边界处校验。附件使用大小、hash、MIME 和过期时间校验，不能接受
本地路径；经 Gateway 时 Gateway 只校验大小、分块中继到 Host，并在
`attachment/complete` 成功或过期后删除副本。首个部署为单租户，路由已携带
`tenantId`，跨租户隔离测试在多租户 harness 就绪后执行。

| Resource | Initial target |
|---|---:|
| Control requests per principal | 120/minute |
| Turn starts per Session | 20/minute |
| Queued turns per Session | 8 |
| Concurrent clients per Host | 16 |
| Concurrent subscriptions per connection | 8 |
| Request/event frame | 1 MiB |
| Prompt payload | 256 KiB |
| Attachment | 50 MiB |
| In-flight attachment uploads per principal | 4 |
| Event send queue | 4 MiB or 1,000 durable events |

## 5. 审计、撤销和验收

待处理审批是 Host 状态：host-core 保有待处理权限表和计时器，Agent Host 通过
`permissions.pending` 读取并脱敏，晚接入的客户端能看到已打开的请求；首个有效
决定生效。远程会话的工具目录只含远端 Host 的工具，首版中桌面插件工具与桌面
配置的 MCP 服务器绝不针对远程工作区执行，provider secret 在任何方向都不经过
RACP。审批寿命是 Host 策略：本地默认仍是 120 秒后拒绝，启用远程控制的
Host 可为远程订阅者配置更长的有界寿命，被阻塞的工具会等待整个寿命，断线不会
延长它。

审计记录包含 principal、tenant、Host、clientConnectionId、Session、Turn、
operation、准入模式与 `effectivePermissionMode`、授权决定、epoch 与序号范围，
但默认不记录 provider secret、原始 prompt、tool 参数、tool 输出或附件字节。
撤销用户、Host、连接、成员或附件后，新的 mutation 必须被拒绝，被撤销主体的
排队回合被取消，已完成回合不能因撤销而重放。

安全验收必须覆盖 TLS、角色矩阵、过期 token、重复 mutation、游标回放、慢客户端、
上传边界、日志脱敏、Host/Gateway 重启、远程权限上限、浏览器 cookie/header
profile 与 URL token 拒绝（浏览器里程碑排期后适用）、中继审批请求只应答一次
（Gateway 里程碑排期后适用）、绑定 loopback 的 `pi-host` 只接受出示有效设备
token 的 loopback 对端且无 TLS 的非 loopback 绑定无法启动、配对 token 单次使用且
只经 SSH 通道传递、远程会话只暴露远端 Host 的工具目录，以及多租户 harness 就绪
后的跨租户隔离。

## 6. 修订记录

D376（2026-09-10）新增浏览器 cookie/header 认证 profile、两种可接受的身份源、
远程权限上限、本地决策词汇、远程审批寿命策略、Host link 与 Gateway 附件中继
规则、单租户优先条款以及验收门 13–15。

D377（2026-09-10）新增 SSH 引导配对、经 SSH 端口转发的 `pi-host` loopback 规则、
SSH 配对 owner 设备的上限豁免、远程工具目录与 provider 配置规则、验收门 16–18，
并把 Gateway 与 cookie profile 条款标记为属于不排期的里程碑。

