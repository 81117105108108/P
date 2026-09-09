# 远程 Agent 控制交付与验收

- 状态：目标交付规格，属于 MVP 之后
- 决策：D373 / ADR 0205
- 英文源规格：[英文源规格](/spec/06-delivery/07-remote-control-rollout)

## 1. 交付边界

当前 MVP 仍然只提供本地 Electron Main、pi sidecar、Rust host-core、
loopback MCP；不得直接暴露 host-core 或现有 IPC。远程工作先从 typed
facade、fixture 和状态机测试开始。

## 2. 里程碑

- R0：完成 RACP v1 资源、错误、游标、幂等和能力协商 fixture。
- R1：在 Electron Main 上提供仅开发环境可用的 Agent Host facade。
- R2：提供 RACP-WS、TLS、审批、心跳、回压和撤销。
- R3：提供独立 Gateway 与 Host 出站连接。
- R4：提供 HTTP/JSON + SSE 浏览器绑定。
- R5：在语义稳定后提供 gRPC 和生成式客户端。

每个阶段都必须保持本地 stdio 和 loopback MCP 不变，并通过远程场景
E2E-221 至 E2E-230。

## 3. 验证

必须覆盖协议 schema、会话/回合/审批状态机、幂等、游标回放、权限矩阵、
三种 binding 一致性、附件 hash、慢客户端、Host/Gateway 重启、NAT 出站
连接以及审计脱敏。

## 4. 发布与回滚

先发布禁用代码路径，再对 allowlist 用户启用。kill switch 只拒绝新的
远程连接，不影响本地桌面。回滚不得重放回合，必须支持连接撤销、审计
和本地会话继续运行。

## 5. 生产准入

只有在 E2E-221 至 E2E-230、远程安全门、binding parity、故障注入、
运营仪表盘和 runbook 全部完成后，远程能力才可进入生产。
