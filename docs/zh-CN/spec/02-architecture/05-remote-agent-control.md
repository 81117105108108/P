# 远程 Agent 控制目标架构

- 状态：目标规格，属于 MVP 之后
- 决策：D373 / ADR 0205
- 英文源规格：[英文源规格](/spec/02-architecture/05-remote-agent-control)

本页是英文规范的中文导读。远程控制当前仍不属于 MVP，不会把现有
Electron IPC、`host.proxy` 或 Rust host-core 暴露到网络。

## 1. 范围与原则

目标是让经过认证的远程客户端查看和控制 Agent Host，同时保持会话、
回合、事件游标、审批、附件、工作区和权限都由 Host 掌权。

- 客户端可以断开，Agent 回合仍继续。
- 重连使用快照或 `afterSequence` 回放，不依赖时间戳。
- JSON-RPC over WSS 是交互主通道；HTTP/JSON + SSE 面向浏览器；
  gRPC 面向原生客户端和 Gateway-to-Host。
- 本地 stdio NDJSON JSON-RPC、Rust host-core 和 loopback MCP 保持不变。

## 2. 参考实现

设计参考 OpenAI Codex App Server、VS Code Agent Host、MCP Transport 和
Google A2A 的分层方式，但不恢复已撤回的子代理 A2A/Peer 协调通道。

## 3. 组件职责

| 组件 | 职责 | 不得拥有 |
|---|---|---|
| Remote Client | 展示状态、发送用户意图、回答审批和输入 | 工作区权限、provider 凭据、最终权限决定 |
| Agent Host | 拥有会话、回合、事件游标、附件、工具执行和生命周期 | 浏览器展示状态 |
| Gateway | 身份认证、路由、连接、限流、审计 | provider secret、完整 transcript、host-core 访问 |
| Electron Main adapter | 迁移期复用现有 Main handler | 第二套权限或持久化实现 |
| Node pi sidecar | 运行 pi Agent 和 provider stream | 远程认证、工作区策略、secret storage |
| Rust host-core | SQLite、工具、工作区、权限、secret 和本地持久化 | 公网监听器 |

## 4. 部署拓扑

### 4.1 当前本地桌面

```text
PI-Desktop
├── Electron Main
│   ├── Renderer
│   ├── Node pi sidecar
│   └── Rust host-core
└── optional loopback MCP
```

### 4.2 开发或可信 LAN

```text
Remote Client ── WSS / SSH tunnel ── Agent Host
                                      ├── pi sidecar
                                      └── Rust host-core
```

### 4.3 生产 Gateway

```text
Client ── HTTPS/WSS ── Gateway
                         │ outbound WSS or gRPC
                         ▼
                      Agent Host ── pi + Rust host-core
```

生产模式由 Agent Host 主动建立出站连接，Gateway 不要求桌面开放入站端口。

## 5. 角色与事件同步

每个会话允许多个 viewer，但同一时间只允许一个活动回合。controller
可以启动或中断回合，approver 只能在授权范围内解决审批，owner 管理成员。

Host 为每个会话分配严格递增的 `sequence`。客户端先取得快照，再按游标
接收事件；游标失效时必须应用完整快照，不能猜测中间状态。

```text
cursor retained  -> replay sequence > afterSequence
cursor expired   -> resync.required + snapshot
cursor ahead     -> reject and refresh snapshot
```

```text
Client -> initialize / attach / subscribe
Client -> turn/start
Host   -> ordered events
Host   -> approval/request when required
Client -> approval/respond
Host   -> turn terminal event
```

## 6. 传输档案

| Profile | Intended client | Direction | Status |
|---|---|---|---|
| Local stdio JSON-RPC | Electron Main / sidecars | Full duplex | Existing |
| RACP-WS | Native、Electron、交互式浏览器 | Full duplex | Primary remote |
| RACP-HTTP | Browser、simple integrations | Commands + server stream | Browser binding |
| RACP-GRPC | Gateway-to-Host、native service | Unary + server stream | Service binding |

## 7. 故障与迁移

| Failure | Required behavior |
|---|---|
| Client disconnect | 回合继续，保留回放窗口 |
| Client reconnect | 重新认证，按游标回放或返回快照 |
| Gateway disconnect | Host 有界退避重连，本地回合继续 |
| Host unavailable | 拒绝新的 mutation，不自动重放 |
| Host crash | 使用现有恢复策略，已中断工作不自动重放 |
| Duplicate mutation | 相同主体和 key 返回原 idempotent 结果 |
| Event gap | 停止应用并请求快照 |
| Slow client | 有界发送队列，满后带游标断开 |
| Expired approval | 返回超时错误，不执行工具 |

## 8. 验收要点

远程客户端不能取得 host-core、IPC、`host.proxy` 或 provider secret；回合
断线后仍可继续；回放、审批、幂等和三种绑定的一致性测试必须通过。

详见英文源规格中的完整组件归属、迁移边界和验收条款。
