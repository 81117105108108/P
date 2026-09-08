---
title: 架构决策记录
description: 与英文 ADR 一一对应的 PI-Desktop 架构决策阅读入口。
---

# 架构决策记录

ADR 记录那些不应被静默改变的架构选择。中文入口与英文索引保持相同结构；完整记录、状态和决策编号继续以英文页面为源事实。

## 重点决策

| 决策 | 说明 |
|---|---|
| [ADR 0001：Electron 桌面壳](/adr/0001-use-electron) | 桌面窗口与平台能力的承载层 |
| [ADR 0005：本地插件系统](/adr/0005-user-installable-plugin-system) | 用户安装插件的第一阶段边界 |
| [ADR 0009：English-first 全球化](/adr/0009-english-first-globalization) | 源语言、术语和协作规则 |
| [ADR 0010：Rust host core](/adr/0010-rust-backend-host-core) | 特权进程、RPC 与持久化的宿主边界 |
| [ADR 0053：Plan checkpoint](/adr/0053-plan-checkpoint-artifact-and-execution-epoch) | 计划审批、artifact 和执行 epoch |
| [ADR 0079：VitePress 文档站](/adr/0079-vitepress-documentation-site) | 双语文档站的结构与部署方式 |
| [ADR 0083：自定义全局界面字体](/adr/0083-custom-global-ui-font) | 设置字体选择器、内置开源字体与系统字体枚举 |
| [ADR 0089：主动后台子代理委托](/adr/0089-proactive-background-subagent-delegation) | 非阻塞 Task、TaskWait/TaskList/TaskStop 生命周期与权限作用域 |
| [ADR 0090：用户可配置的关闭行为](/adr/0090-user-configurable-close-behavior-close-to-tray) | 首次关闭只问一次，关闭到托盘或退出，设置里可改 |
| [ADR 0095：用厂商账户登录](/adr/0095-vendor-account-oauth-login) | 用订阅账户代替 API 密钥，凭据留在主进程，sidecar 按请求取短时令牌 |
| [ADR 0106：核心五条内置命令](/adr/0106-core-five-builtin-commands) | 将命令面板和输入框 `/` 菜单冻结为五条第一方命令 |
| [ADR 0108：移除内置交互式终端](/adr/0108-remove-built-in-interactive-terminal) | 工作面板不再承载 PTY；交互式 shell 由外部终端承担，Agent Bash 保持非交互式 |
| [ADR 0128：瞬时 provider 故障的有界重试](/adr/0128-bounded-transient-provider-retry) | 为瞬时 provider 故障共享一个有界重试预算，跨请求设置和流式传输阶段共用四次重试 |
| [ADR 0131：大段 Composer 粘贴写入会话临时目录](/adr/0131-large-text-paste-session-reference) | 超过可配置阈值的纯文本粘贴保存为会话临时文件，并在原位置插入内联 `@` 引用 |
| [ADR 0137：保留的会话面板](/adr/0137-retained-session-panes) | 最近访问的会话各自保留一个已挂载的面板（上限三个），切换是可见性交换而不是重建转录 |
| [ADR 0141：展开侧边栏宽度可调整](/adr/0141-sidebar-width-resize) | 展开侧边栏通过右边缘手柄调整 240–520px 宽度，并持久化首选值 |
| [ADR 0142：允许非回环 HTTP MCP 端点](/adr/0142-allow-non-loopback-http-mcp) | 支持局域网 MCP，并明确提示明文连接风险，插件仍受网络白名单约束 |
| [ADR 0145：发布本机 macOS Intel 工件](/adr/0145-native-macos-intel-release-lane) | 通过匹配的 macOS 原生运行器发布 arm64 与 Intel x64 DMG/ZIP，并合并更新源 |
| [ADR 0148：明确禁用应用快捷键](/adr/0148-explicitly-disable-keyboard-shortcuts) | 缺少覆盖使用默认值，`null` 表示未绑定并关闭渲染器、菜单和启动器分发 |
| [ADR 0174：宿主代发的插件补全与会话上下文](/adr/0174-plugin-host-owned-completion-and-session-context) | 插件可通过公开 API 列出已登录模型、读取进行中工具会话，并由宿主代打一次性补全 |
| [ADR 0175：解释安静的进行中回合](/adr/0175-live-agent-activity-status) | 用 waiting-model / retrying / waiting-subagents 状态行说明停顿 |
| [ADR 0176：按供应商覆盖 User-Agent](/adr/0176-per-provider-user-agent) | 每个 AI 服务/OAuth 行可设置可选 User-Agent（已被 0178 的 headers 映射取代） |
| [ADR 0177：用户可配置的出站代理](/adr/0177-user-configurable-outbound-proxy) | 设置里的系统/直连/自定义代理覆盖模型请求、市场、更新和内置浏览器 |
| [ADR 0178：按供应商自定义 HTTP 请求头](/adr/0178-per-provider-custom-headers) | 每个 AI 服务/OAuth 行可在高级选项中编辑任意非敏感请求头 |
| [ADR 0179：从本地智能体存储导入模型配置](/adr/0179-import-model-configuration) | 设置 → 导入显式扫描 Claude Code / Codex / OpenCode / Pi 的提供商配置并复制 API 密钥 |
| [ADR 0180：自定义全局文字缩放](/adr/0180-custom-reading-font-size) | 设置外观按比例缩放全部界面文字，不使用 px，窗口缩放仍独立 |
| [ADR 0181：主进程拥有的文件选择能力](/adr/0181-main-owned-picker-capabilities) | 文件选择路径留在主进程，以一次性令牌保护导入边界，并移除不支持的文件夹选择 |
| [ADR 0182：繁体中文应用程序壳](/adr/0182-traditional-chinese-shell-locale) | 提供独立的繁体中文外壳、系统语言解析和发版日志目录 |
| [ADR 0183：P0 国际化应用程序壳语言](/adr/0183-p0-international-shell-locales) | 提供德语、西班牙语和法语完整外壳目录及发版日志 |
| [ADR 0184：输入框工具栏中的上下文用量检查器](/adr/0184-composer-context-usage-inspector) | 把剩余容量检查器移到模型选择器左侧，答案下方只保留模型徽章 |
 | [ADR 0185：韩语应用程序壳](/adr/0185-korean-shell-locale) | 提供完整韩语外壳、系统语言解析和韩语发版日志目录 |
 | [ADR 0186：显示进行中重试的 provider 原因](/adr/0186-retry-cause-in-active-turn-status) | 悬停或聚焦重试状态行时显示错误摘要、错误码和安全的 provider 消息 |
 | [ADR 0187：区分任务和交互式本机通知投递](/adr/0187-separate-task-and-interactive-native-notification-delivery) | 终端任务保持仅无焦点投递，交互询问可通知聚焦的其他会话 |
 | [ADR 0188：模型配置导入保留不同凭据](/adr/0188-preserve-distinct-import-credentials) | 同一端点的不同 API 密钥作为独立提供商导入，相同凭据仍保持幂等跳过 |
 | [ADR 0189：父级终态错误中止残留委托](/adr/0189-parent-fatal-error-aborts-leftover-delegates) | 父级空闲仍不中止委托；429 等终态错误会中止残留子智能体，让“继续”不再 AGENT_BUSY |

## 什么时候看 ADR

- 规格告诉你系统应该怎样工作。
- ADR 告诉你为什么选择这个边界，以及哪些替代方案被放弃。
- 决策日志记录更细的冻结条款和后续修订。

前往 [英文 ADR 索引](/adr/README) 查看完整记录，或打开 [中文决策日志](/zh-CN/spec/08-meta/decisions-log) 按编号检索。
