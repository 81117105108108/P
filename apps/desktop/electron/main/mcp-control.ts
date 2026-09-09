import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A small JSON Schema subset used by MCP's tools/list response. */
export type McpJsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  description?: string;
  properties?: Record<string, McpJsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: McpJsonSchema;
  enum?: string[];
};

export type McpControlRisk = "read" | "write" | "dangerous";

export type McpControlOperation = {
  id: string;
  channel: string;
  description: string;
  risk: McpControlRisk;
};

export type McpControlConnectionInfo = {
  active: boolean;
  serverName: string;
  protocol: "streamable-http";
  url: string;
  token: string;
  pid: number;
  startedAt?: string;
};

type IpcInvoke = (channel: string, args: readonly unknown[]) => Promise<unknown>;
type OperationSpec = {
  channelKey: string;
  id: string;
  description: string;
  risk: McpControlRisk;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: McpJsonSchema;
  execute: (input: unknown) => Promise<unknown>;
};

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type DispatchResult = {
  response: JsonRpcResponse;
  sessionId?: string;
};

type Logger = (level: "info" | "warn" | "error", message: string, data?: unknown) => void;

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_NAME = "pi-desktop";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 37_123;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_CHARS = 512 * 1024;
const MAX_ARGUMENT_ITEMS = 32;

const objectSchema = (
  properties: Record<string, McpJsonSchema>,
  required: string[] = [],
): McpJsonSchema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const anySchema = (): McpJsonSchema => ({
  additionalProperties: true,
});

const stringSchema = (description?: string): McpJsonSchema => ({
  type: "string",
  ...(description ? { description } : {}),
});

const booleanSchema = (description?: string): McpJsonSchema => ({
  type: "boolean",
  ...(description ? { description } : {}),
});

const operationSpecs = (...specs: OperationSpec[]): OperationSpec[] => specs;

const spec = (
  channelKey: string,
  id: string,
  description: string,
  risk: McpControlRisk = "write",
): OperationSpec => ({ channelKey, id, description, risk });

/**
 * IPC operations that are safe to expose through the local control plane.
 *
 * The list deliberately excludes secret reads/writes and renderer-only native
 * pickers. A future IPC channel is not automatically exposed until its
 * external-agent behavior and risk have been reviewed here.
 */
const CONTROL_OPERATION_SPECS = operationSpecs(
  spec("appGetVersion", "app/getVersion", "Return PI-Desktop and host versions.", "read"),
  spec("appHealth", "app/health", "Return host health.", "read"),
  spec("appGetOnboarding", "app/getOnboarding", "Read onboarding state.", "read"),
  spec("appDismissOnboarding", "app/dismissOnboarding", "Dismiss onboarding."),
  spec("systemFontsList", "app/systemFonts", "List installed system fonts.", "read"),
  spec("appOpenFeedback", "app/openFeedback", "Open the PI-Desktop feedback page.", "dangerous"),
  spec("pluginLauncherToggle", "pluginLauncher/toggle", "Toggle the command launcher."),
  spec("updatesGetState", "updates/getState", "Read application update state.", "read"),
  spec("updatesCheck", "updates/check", "Check for application updates.", "write"),
  spec("updatesDownload", "updates/download", "Download the available application update.", "dangerous"),
  spec("updatesInstall", "updates/install", "Install a downloaded application update.", "dangerous"),
  spec("updatesOpenReleases", "updates/openReleases", "Open the release page.", "dangerous"),
  spec("notificationList", "notification/list", "List durable notifications.", "read"),
  spec("notificationMarkRead", "notification/markRead", "Mark one notification as read."),
  spec("notificationMarkAllRead", "notification/markAllRead", "Mark all notifications as read."),
  spec("notificationClear", "notification/clear", "Clear durable notifications.", "dangerous"),
  spec("notificationSetViewingSession", "notification/setViewingSession", "Set the session currently visible to notification policy."),
  spec("notificationShowNative", "notification/showNative", "Show a native notification.", "dangerous"),
  spec("agentInstructionsGet", "agent/instructions/get", "Read global or project AGENTS.md instructions.", "read"),
  spec("agentInstructionsSave", "agent/instructions/save", "Write global or project AGENTS.md instructions.", "dangerous"),
  spec("agentPrompt", "agent/prompt", "Send a prompt to a session's Agent."),
  spec("promptEnhance", "prompt/enhance", "Enhance a prompt using the configured model."),
  spec("agentCompact", "agent/compact", "Compact an idle session context."),
  spec("agentAbort", "agent/abort", "Abort an active Agent turn."),
  spec("agentStop", "agent/stop", "Request a graceful Agent stop."),
  spec("agentGetStatus", "agent/getStatus", "Read Agent runtime status.", "read"),
  spec("sessionList", "session/list", "List durable sessions.", "read"),
  spec("sessionCreate", "session/create", "Create a durable session."),
  spec("sessionFork", "session/fork", "Fork a session."),
  spec("sessionGet", "session/get", "Read a session and its transcript.", "read"),
  spec("sessionDelete", "session/delete", "Delete a session.", "dangerous"),
  spec("sessionRename", "session/rename", "Rename a session."),
  spec("sessionConfigure", "session/configure", "Configure a session for its next turn."),
  spec("sessionReplaceMessages", "session/replaceMessages", "Replace a session transcript.", "dangerous"),
  spec("sessionSaveRevision", "session/saveRevision", "Save a transcript revision.", "dangerous"),
  spec("sessionListRevisions", "session/listRevisions", "List transcript revisions.", "read"),
  spec("sessionActivateRevision", "session/activateRevision", "Activate a transcript revision.", "dangerous"),
  spec("sessionGetScratchPath", "session/getScratchPath", "Return a session scratch path.", "read"),
  spec("sessionImportScan", "session/importScan", "Scan supported external session sources.", "read"),
  spec("sessionImportRun", "session/importRun", "Import selected external sessions.", "dangerous"),
  spec("modelConfigImportScan", "modelConfig/importScan", "Scan supported model configuration sources.", "read"),
  spec("modelConfigImportRun", "modelConfig/importRun", "Import selected model configurations.", "dangerous"),
  spec("sessionSummarizeTitle", "session/summarizeTitle", "Generate a session title."),
  spec("settingsGet", "settings/get", "Read application settings.", "read"),
  spec("settingsSet", "settings/set", "Replace application settings.", "dangerous"),
  spec("networkProxyTest", "network/testProxy", "Test a network proxy configuration.", "read"),
  spec("commandShellList", "commandShell/list", "List supported command shells.", "read"),
  spec("providersList", "providers/list", "List configured providers without plaintext secrets.", "read"),
  spec("providersCreate", "providers/create", "Create a provider configuration.", "dangerous"),
  spec("providersUpdate", "providers/update", "Update a provider configuration.", "dangerous"),
  spec("providersDelete", "providers/delete", "Delete a provider configuration.", "dangerous"),
  spec("providersTest", "providers/testConnection", "Test a provider connection.", "dangerous"),
  spec("providersListModels", "providers/listModels", "List cached provider models.", "read"),
  spec("providersRefreshModelCatalog", "providers/refreshModelCatalog", "Refresh the models.dev catalog.", "write"),
  spec("providersModelCatalogStatus", "providers/modelCatalogStatus", "Read model catalog status.", "read"),
  spec("providersOauthVendors", "providers/oauth/vendors", "List OAuth vendors and local accounts.", "read"),
  spec("providersOauthStart", "providers/oauth/start", "Start an OAuth login flow.", "dangerous"),
  spec("providersOauthRespond", "providers/oauth/respond", "Respond to an OAuth login prompt.", "dangerous"),
  spec("providersOauthCancel", "providers/oauth/cancel", "Cancel an OAuth login flow.", "dangerous"),
  spec("providersOauthDelete", "providers/oauth/delete", "Delete a local OAuth account.", "dangerous"),
  spec("projectGet", "project/get", "Read the active project workspace.", "read"),
  spec("projectList", "project/list", "List durable projects.", "read"),
  spec("projectSet", "project/set", "Open and bind a project path."),
  spec("projectClear", "project/clear", "Clear the active project."),
  spec("projectOpenFolder", "project/openFolder", "Open a known project folder in the OS file manager.", "dangerous"),
  spec("workspaceDiff", "workspace/diff", "Read the active workspace diff.", "read"),
  spec("workspaceReviewRollback", "workspace/review/rollback", "Roll back a reversible workspace review change.", "dangerous"),
  spec("statsGetTokenUsageHistory", "stats/getTokenUsageHistory", "Read completed-turn token usage history.", "read"),
  spec("browserNavigate", "browser/navigate", "Navigate the embedded Browser panel."),
  spec("browserAction", "browser/action", "Control the embedded Browser panel."),
  spec("browserSetBounds", "browser/setBounds", "Set the embedded Browser panel bounds.", "dangerous"),
  spec("browserSetVisible", "browser/setVisible", "Show or hide the embedded Browser panel."),
  spec("browserOpenExternal", "browser/openExternal", "Open the Browser URL externally.", "dangerous"),
  spec("browserGetState", "browser/getState", "Read embedded Browser state.", "read"),
  spec("fsList", "fs/list", "List files in the active workspace.", "read"),
  spec("fsRead", "fs/read", "Read an allowed workspace or session file.", "read"),
  spec("fsReadImageDataUrl", "fs/readImageDataUrl", "Read an allowed image as a data URL.", "read"),
  spec("fsReveal", "fs/reveal", "Reveal an allowed file in the OS file manager.", "dangerous"),
  spec("fsOpen", "fs/open", "Open an allowed file with its OS handler.", "dangerous"),
  spec("fsIndex", "fs/index", "Index files in the active workspace.", "read"),
  spec("composerCommands", "composer/commands", "List composer command templates.", "read"),
  spec("windowSetWorkPanelReservation", "window/setWorkPanelReservation", "Set the work-panel reservation."),
  spec("windowSetWorkPanelChatWidth", "window/setWorkPanelChatWidth", "Set the work-panel chat width."),
  spec("windowSetBackgroundColor", "window/setBackgroundColor", "Set the native window background theme."),
  spec("windowControl", "window/control", "Control the main window.", "dangerous"),
  spec("closeBehaviorGet", "window/closeBehavior/get", "Read close behavior.", "read"),
  spec("closeBehaviorSet", "window/closeBehavior/set", "Set close-to-tray or close-to-quit behavior.", "dangerous"),
  spec("nativeMenuAction", "menu/nativeAction", "Run a native application-menu action.", "dangerous"),
  spec("pullsList", "pulls/list", "List pull requests for the active workspace.", "read"),
  spec("scheduledList", "scheduled/list", "List scheduled tasks.", "read"),
  spec("scheduledCreate", "scheduled/create", "Create a scheduled task.", "dangerous"),
  spec("scheduledUpdate", "scheduled/update", "Update a scheduled task.", "dangerous"),
  spec("scheduledDelete", "scheduled/delete", "Delete a scheduled task.", "dangerous"),
  spec("scheduledRun", "scheduled/run", "Run a scheduled task now.", "dangerous"),
  spec("toolResolvePermission", "tool/resolvePermission", "Resolve a pending tool permission request.", "dangerous"),
  spec("askToolResolve", "agent/askTool/resolve", "Answer an Agent question.", "dangerous"),
  spec("plansPending", "plans/pending", "List pending Plan or Goal approvals.", "read"),
  spec("plansResolve", "plans/resolve", "Approve or reject a Plan or Goal checkpoint.", "dangerous"),
  spec("pluginList", "plugin/list", "List installed plugins.", "read"),
  spec("pluginSettingsGet", "plugin/settings/get", "Read plugin setting definitions.", "read"),
  spec("pluginSettingsSet", "plugin/settings/set", "Set plugin settings.", "dangerous"),
  spec("pluginLoadDev", "plugin/loadDev", "Load a development plugin.", "dangerous"),
  spec("pluginReload", "plugin/reload", "Reload a development plugin.", "dangerous"),
  spec("pluginEnable", "plugin/enable", "Enable a plugin.", "dangerous"),
  spec("pluginDisable", "plugin/disable", "Disable a plugin.", "dangerous"),
  spec("pluginUninstall", "plugin/uninstall", "Uninstall a plugin.", "dangerous"),
  spec("pluginSetAutoUpdate", "plugin/setAutoUpdate", "Set a plugin's auto-update policy.", "dangerous"),
  spec("pluginSetScope", "plugin/setScope", "Set a plugin activation scope.", "dangerous"),
  spec("pluginOpenPanel", "plugin/openPanel", "Open a plugin panel."),
  spec("pluginViews", "plugin/views", "List plugin-contributed views.", "read"),
  spec("pluginViewOpen", "plugin/view/open", "Open a plugin view."),
  spec("pluginViewClose", "plugin/view/close", "Close a plugin view."),
  spec("pluginViewSetBounds", "plugin/view/setBounds", "Set a plugin view bounds.", "dangerous"),
  spec("pluginViewSetVisible", "plugin/view/setVisible", "Show or hide a plugin view."),
  spec("pluginThemes", "plugin/themes", "List plugin themes.", "read"),
  spec("pluginServices", "plugin/services", "List plugin service states.", "read"),
  spec("mcpList", "mcp/list", "List user-owned MCP servers.", "read"),
  spec("mcpUpsert", "mcp/upsert", "Create or update a user-owned MCP server.", "dangerous"),
  spec("mcpRemove", "mcp/remove", "Remove a user-owned MCP server.", "dangerous"),
  spec("mcpSetEnabled", "mcp/setEnabled", "Enable or disable a user-owned MCP server.", "dangerous"),
  spec("mcpSetScope", "mcp/setScope", "Set an MCP server activation scope.", "dangerous"),
  spec("mcpTest", "mcp/test", "Test a user-owned MCP server.", "dangerous"),
  spec("mcpImport", "mcp/import", "Import user-owned MCP server definitions.", "dangerous"),
  spec("skillList", "skill/list", "List user-owned Skills.", "read"),
  spec("skillCreate", "skill/create", "Create a user-owned Skill.", "dangerous"),
  spec("skillUpdate", "skill/update", "Update a user-owned Skill.", "dangerous"),
  spec("skillRead", "skill/read", "Read a user-owned Skill.", "read"),
  spec("skillRemove", "skill/remove", "Remove a user-owned Skill.", "dangerous"),
  spec("skillSetEnabled", "skill/setEnabled", "Enable or disable a user-owned Skill.", "dangerous"),
  spec("skillSetScope", "skill/setScope", "Set a Skill activation scope.", "dangerous"),
  spec("skillReveal", "skill/reveal", "Reveal a Skill file.", "dangerous"),
  spec("subagentList", "subagent/list", "List user-owned Subagents.", "read"),
  spec("subagentCatalog", "subagent/catalog", "Read the effective Subagent catalog.", "read"),
  spec("subagentCreate", "subagent/create", "Create a user-owned Subagent.", "dangerous"),
  spec("subagentUpdate", "subagent/update", "Update a user-owned Subagent.", "dangerous"),
  spec("subagentRead", "subagent/read", "Read a user-owned Subagent.", "read"),
  spec("subagentRemove", "subagent/remove", "Remove a user-owned Subagent.", "dangerous"),
  spec("subagentSetEnabled", "subagent/setEnabled", "Enable or disable a user-owned Subagent.", "dangerous"),
  spec("subagentSetScope", "subagent/setScope", "Set a Subagent activation scope.", "dangerous"),
  spec("subagentReveal", "subagent/reveal", "Reveal a Subagent file.", "dangerous"),
  spec("marketRefresh", "market/refresh", "Refresh the plugin marketplace catalog.", "dangerous"),
  spec("marketSearch", "market/search", "Search the plugin marketplace.", "read"),
  spec("marketGetDetail", "market/getDetail", "Read marketplace plugin details.", "read"),
  spec("marketInstall", "market/install", "Install a marketplace plugin.", "dangerous"),
  spec("marketCheckUpdates", "market/checkUpdates", "Check marketplace plugin updates.", "dangerous"),
  spec("marketApplyUpdates", "market/applyUpdates", "Apply marketplace plugin updates.", "dangerous"),
  spec("commandPaletteSearch", "commandPalette/search", "Search command-palette commands.", "read"),
  spec("commandPaletteExecute", "commandPalette/execute", "Execute a command-palette command.", "dangerous"),
  spec("logOpenFolder", "log/openFolder", "Open the PI-Desktop log folder.", "dangerous"),
  spec("devtoolsToggle", "devtools/toggle", "Open or close developer tools.", "dangerous"),
);

const coreTool = (
  name: string,
  description: string,
  inputSchema: McpJsonSchema,
  operationId: string,
  toArgs: (input: Record<string, unknown>) => readonly unknown[],
): { name: string; description: string; inputSchema: McpJsonSchema; operationId: string; toArgs: (input: Record<string, unknown>) => readonly unknown[] } => ({
  name,
  description,
  inputSchema,
  operationId,
  toArgs,
});

const CORE_TOOL_SPECS = [
  coreTool("pi_app_info", "Read PI-Desktop and host version information.", objectSchema({}), "app/getVersion", () => []),
  coreTool("pi_project_get", "Read the active project workspace.", objectSchema({}), "project/get", () => []),
  coreTool("pi_project_list", "List durable projects.", objectSchema({}), "project/list", () => []),
  coreTool(
    "pi_project_open",
    "Open and bind a project directory by absolute or user-resolvable path.",
    objectSchema({ path: stringSchema("Project directory path.") }, ["path"]),
    "project/set",
    (input) => [input.path],
  ),
  coreTool("pi_project_clear", "Clear the active project workspace.", objectSchema({}), "project/clear", () => []),
  coreTool("pi_session_list", "List durable sessions.", objectSchema({}), "session/list", () => []),
  coreTool(
    "pi_session_create",
    "Create a durable session, optionally bound to a project and model.",
    objectSchema({
      title: stringSchema(),
      projectPath: stringSchema(),
      mode: { type: "string", enum: ["agent", "plan", "goal"] },
      providerId: stringSchema(),
      modelId: stringSchema(),
      thinkingLevel: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
    }),
    "session/create",
    (input) => [input],
  ),
  coreTool(
    "pi_session_get",
    "Read a session and a bounded transcript page.",
    objectSchema({
      id: stringSchema("Session id."),
      messageBefore: { type: "integer" },
      messageLimit: { type: "integer" },
      contentLimit: { type: "integer" },
    }, ["id"]),
    "session/get",
    (input) => [input],
  ),
  coreTool(
    "pi_session_rename",
    "Rename a session.",
    objectSchema({ id: stringSchema("Session id."), title: stringSchema("New title.") }, ["id", "title"]),
    "session/rename",
    (input) => [input.id, input.title],
  ),
  coreTool(
    "pi_session_fork",
    "Fork a session, optionally at a transcript message.",
    objectSchema({ id: stringSchema("Source session id."), title: stringSchema(), throughMessageId: stringSchema() }, ["id"]),
    "session/fork",
    (input) => [{ sessionId: input.id, title: input.title, throughMessageId: input.throughMessageId }],
  ),
  coreTool(
    "pi_session_delete",
    "Delete a session. Set confirm=true to acknowledge the destructive action.",
    objectSchema({ id: stringSchema("Session id."), confirm: booleanSchema("Required acknowledgement.") }, ["id", "confirm"]),
    "session/delete",
    (input) => [input.id],
  ),
  coreTool(
    "pi_session_configure",
    "Configure a session for its next turn.",
    objectSchema({
      id: stringSchema("Session id."),
      mode: { type: "string", enum: ["agent", "plan", "goal"] },
      providerId: stringSchema(),
      modelId: stringSchema(),
      thinkingLevel: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
      permissionMode: { type: "string", enum: ["inherit", "ask", "accept-edits", "auto"] },
    }, ["id", "mode"]),
    "session/configure",
    (input) => {
      const { id, ...config } = input;
      return [id, config];
    },
  ),
  coreTool(
    "pi_agent_prompt",
    "Send a prompt to a session's Agent.",
    objectSchema({
      sessionId: stringSchema("Target session id."),
      content: stringSchema("Prompt text."),
      viewingSessionId: stringSchema(),
      attachments: { type: "array", items: anySchema() },
    }, ["sessionId", "content"]),
    "agent/prompt",
    (input) => [input],
  ),
  coreTool(
    "pi_agent_status",
    "Read a session's Agent runtime status.",
    objectSchema({ sessionId: stringSchema("Target session id.") }, ["sessionId"]),
    "agent/getStatus",
    (input) => [input.sessionId],
  ),
  coreTool(
    "pi_agent_stop",
    "Request a graceful stop at the next Agent turn boundary.",
    objectSchema({ sessionId: stringSchema("Target session id.") }, ["sessionId"]),
    "agent/stop",
    (input) => [input],
  ),
  coreTool(
    "pi_agent_abort",
    "Abort the active Agent turn.",
    objectSchema({ sessionId: stringSchema("Target session id.") }, ["sessionId"]),
    "agent/abort",
    (input) => [input],
  ),
  coreTool(
    "pi_agent_compact",
    "Compact an idle session context.",
    objectSchema({ sessionId: stringSchema("Target session id.") }, ["sessionId"]),
    "agent/compact",
    (input) => [input],
  ),
  coreTool(
    "pi_plans_pending",
    "List pending Plan or Goal approvals.",
    objectSchema({ sessionId: stringSchema() }),
    "plans/pending",
    (input) => [input],
  ),
  coreTool(
    "pi_plans_resolve",
    "Approve or reject a Plan or Goal checkpoint.",
    objectSchema({
      proposalId: stringSchema("Proposal id."),
      sessionId: stringSchema("Session id."),
      turnId: stringSchema("Turn id."),
      toolCallId: stringSchema("Plan tool-call id."),
      action: { type: "string", enum: ["approve", "reject"] },
      version: { type: "integer" },
      targetPermissionMode: { type: "string", enum: ["ask", "accept-edits", "auto"] },
      confirm: booleanSchema("Required acknowledgement for approval or rejection."),
    }, ["proposalId", "sessionId", "turnId", "toolCallId", "action", "confirm"]),
    "plans/resolve",
    (input) => {
      const { confirm: _confirm, ...resolution } = input;
      return [resolution];
    },
  ),
  coreTool("pi_workspace_diff", "Read the active workspace diff.", objectSchema({}), "workspace/diff", () => []),
  coreTool(
    "pi_fs_list",
    "List files in the active workspace.",
    objectSchema({ path: stringSchema("Workspace-relative path.") }),
    "fs/list",
    (input) => [input],
  ),
  coreTool(
    "pi_fs_read",
    "Read an allowed workspace or session file.",
    objectSchema({ path: stringSchema("Workspace-relative path or allowed attachment ref."), mimeType: stringSchema() }, ["path"]),
    "fs/read",
    (input) => [input],
  ),
] as const;

function operationIdForChannel(channel: string): string {
  return channel.startsWith("pi-desktop/") ? channel.slice("pi-desktop/".length) : channel;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("tool arguments must be an object"), { code: "INVALID_PARAMS" });
  }
  return value as Record<string, unknown>;
}

function serialize(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value ?? null);
  } catch {
    text = JSON.stringify({ value: String(value) });
  }
  if (text.length <= MAX_RESULT_CHARS) return text;
  return JSON.stringify({
    truncated: true,
    reason: "MCP_RESULT_LIMIT",
    preview: text.slice(0, MAX_RESULT_CHARS),
  });
}

function errorInfo(error: unknown): { code: string; message: string; details?: unknown } {
  const candidate = error as {
    code?: unknown;
    errorCode?: unknown;
    message?: unknown;
    data?: { errorCode?: unknown; details?: unknown };
  } | null;
  const code = String(candidate?.data?.errorCode ?? candidate?.errorCode ?? candidate?.code ?? "INTERNAL");
  const message = String(candidate?.message ?? error ?? "operation failed");
  const details = candidate?.data?.details;
  return details === undefined ? { code, message } : { code, message, details };
}

function response(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export function createMcpControlOperations(
  channels: Readonly<Record<string, string>>,
): McpControlOperation[] {
  return CONTROL_OPERATION_SPECS.flatMap((entry) => {
    const channel = channels[entry.channelKey];
    if (!channel) return [];
    return [{ id: entry.id, channel, description: entry.description, risk: entry.risk }];
  });
}

export type McpControlServerOptions = {
  dataDir: string;
  invoke: IpcInvoke;
  channels: Readonly<Record<string, string>>;
  host?: string;
  port?: number;
  onOperationComplete?: (
    operation: McpControlOperation,
    result: unknown,
    args: readonly unknown[],
  ) => void | Promise<void>;
  log?: Logger;
};

/**
 * Local Streamable HTTP MCP server for controlling the running desktop.
 *
 * This server intentionally owns no product logic. Every operation delegates
 * to the same Electron-main IPC handler used by the renderer, which keeps the
 * external-agent surface aligned with the desktop's permission and lifecycle
 * checks.
 */
export class McpControlServer {
  private readonly dataDir: string;
  private readonly invoke: IpcInvoke;
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly onOperationComplete?: McpControlServerOptions["onOperationComplete"];
  private readonly log: Logger;
  private readonly operations: McpControlOperation[];
  private readonly operationById = new Map<string, McpControlOperation>();
  private readonly sessions = new Set<string>();
  private readonly serverName = MCP_SERVER_NAME;
  private server: ReturnType<typeof createServer> | null = null;
  private token = "";
  private port: number | null = null;
  private startedAt: string | undefined;

  constructor(options: McpControlServerOptions) {
    this.dataDir = options.dataDir;
    this.invoke = options.invoke;
    this.host = options.host ?? DEFAULT_HOST;
    this.requestedPort = options.port ?? DEFAULT_PORT;
    this.onOperationComplete = options.onOperationComplete;
    this.log = options.log ?? (() => undefined);
    this.operations = createMcpControlOperations(options.channels);
    for (const operation of this.operations) this.operationById.set(operation.id, operation);
  }

  get isRunning(): boolean {
    return this.server !== null && this.port !== null;
  }

  get connectionInfo(): McpControlConnectionInfo | null {
    if (!this.port || !this.token) return null;
    return {
      active: this.isRunning,
      serverName: this.serverName,
      protocol: "streamable-http",
      url: `http://${this.host}:${this.port}/mcp`,
      token: this.token,
      pid: process.pid,
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
    };
  }

  async start(): Promise<McpControlConnectionInfo | null> {
    if (this.server) return this.connectionInfo;
    if (!Number.isInteger(this.requestedPort) || this.requestedPort < 0 || this.requestedPort > 65_535) {
      throw new Error("invalid MCP control port");
    }
    await mkdir(this.dataDir, { recursive: true });
    this.token = await this.loadToken();
    const server = createServer((request, result) => {
      void this.handleRequest(request, result);
    });
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.requestedPort, this.host);
      });
    } catch (error) {
      this.server = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
    const address = server.address();
    if (!address || typeof address === "string") {
      await this.stop();
      throw new Error("MCP control server did not expose a TCP address");
    }
    this.port = address.port;
    this.startedAt = new Date().toISOString();
    const info = this.connectionInfo;
    if (!info) {
      await this.stop();
      throw new Error("MCP control connection info unavailable");
    }
    try {
      await this.writeConnectionInfo(info);
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
    this.log("info", "MCP control server listening", {
      url: info.url,
      port: this.port,
      operationCount: this.operations.length,
    });
    return info;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.sessions.clear();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const info = this.connectionInfo;
    if (info) await this.writeConnectionInfo({ ...info, active: false });
    this.port = null;
  }

  private async loadToken(): Promise<string> {
    const path = join(this.dataDir, "mcp-control.token");
    try {
      const existing = (await readFile(path, "utf8")).trim();
      if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
    } catch {
      // Generate the first token below.
    }
    const token = randomBytes(32).toString("hex");
    await writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await chmod(path, 0o600);
    } catch {
      // Windows does not expose POSIX mode bits.
    }
    return token;
  }

  private async writeConnectionInfo(info: McpControlConnectionInfo): Promise<void> {
    const path = join(this.dataDir, "mcp-control.json");
    await writeFile(path, `${JSON.stringify(info, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await chmod(path, 0o600);
    } catch {
      // Windows does not expose POSIX mode bits.
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : request.headers["x-pi-desktop-token"];
    return typeof token === "string" && token === this.token;
  }

  private isAllowedOrigin(request: IncomingMessage): boolean {
    const rawOrigin = request.headers.origin;
    if (!rawOrigin) return true;
    try {
      const origin = new URL(rawOrigin);
      if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
      return origin.hostname === "localhost" ||
        origin.hostname === "127.0.0.1" ||
        origin.hostname === "[::1]" ||
        origin.hostname === "::1";
    } catch {
      return false;
    }
  }

  private protocolVersion(request: IncomingMessage): string | null {
    const value = request.headers["mcp-protocol-version"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private async handleRequest(request: IncomingMessage, result: ServerResponse): Promise<void> {
    result.setHeader("Cache-Control", "no-store");
    result.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "OPTIONS") {
      result.writeHead(204, {
        Allow: "POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, X-Pi-Desktop-Token",
        "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
      });
      result.end();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== "/mcp" && pathname !== "/mcp/") {
      this.sendHttp(result, 404, { error: "not found" });
      return;
    }
    if (!this.isAllowedOrigin(request)) {
      this.sendHttp(result, 403, { error: "origin not allowed" });
      return;
    }
    if (!this.isAuthorized(request)) {
      this.sendHttp(result, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return;
    }
    if (request.method === "DELETE") {
      const sessionId = this.sessionId(request);
      if (!sessionId || !this.sessions.has(sessionId)) {
        this.sendHttp(result, 404, { error: "unknown MCP session" });
        return;
      }
      this.sessions.delete(sessionId);
      result.writeHead(204);
      result.end();
      return;
    }
    if (request.method === "GET") {
      this.sendHttp(result, 405, { error: "SSE stream not supported" }, { Allow: "POST, DELETE, OPTIONS" });
      return;
    }
    if (request.method !== "POST") {
      this.sendHttp(result, 405, { error: "method not allowed" }, { Allow: "POST, DELETE, OPTIONS" });
      return;
    }
    let body: unknown;
    try {
      body = await this.readJson(request);
    } catch (error) {
      this.sendJsonRpc(result, rpcError(null, -32700, error instanceof Error ? error.message : "invalid JSON"));
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      this.sendJsonRpc(result, rpcError(null, -32600, "JSON-RPC request must be an object"));
      return;
    }
    const requestBody = body as JsonRpcRequest;
    const id = requestBody.id ?? null;
    const method = typeof requestBody.method === "string" ? requestBody.method : "";
    const sessionId = this.sessionId(request);
    const protocolVersion = this.protocolVersion(request);
    if (protocolVersion && protocolVersion !== MCP_PROTOCOL_VERSION && protocolVersion !== "2025-03-26") {
      this.sendHttp(result, 400, { error: "unsupported MCP protocol version" });
      return;
    }
    if (method !== "initialize" && !sessionId) {
      this.sendHttp(result, 400, { error: "Mcp-Session-Id is required" });
      return;
    }
    if (method !== "initialize" && sessionId && !this.sessions.has(sessionId)) {
      this.sendHttp(result, 404, { error: "unknown MCP session" });
      return;
    }
    try {
      const dispatched = await this.dispatch(requestBody);
      if (dispatched === null) {
        result.writeHead(202);
        result.end();
        return;
      }
      this.sendJsonRpc(
        result,
        dispatched.response,
        dispatched.sessionId ? { "Mcp-Session-Id": dispatched.sessionId } : undefined,
      );
    } catch (error) {
      this.sendJsonRpc(result, rpcError(id, -32603, "internal error", errorInfo(error)));
    }
  }

  private async dispatch(request: JsonRpcRequest): Promise<DispatchResult | null> {
    const id = request.id ?? null;
    const method = typeof request.method === "string" ? request.method : "";
    const params = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
    if (method === "initialize") {
      const sessionId = randomUUID();
      this.sessions.add(sessionId);
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION;
      return {
        response: response(id, {
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.serverName, version: "1" },
          instructions: "Use pi_session_create, pi_project_open, pi_agent_prompt, and pi_desktop_invoke to control PI-Desktop.",
        }),
        sessionId,
      };
    }
    if (method === "notifications/initialized") return null;
    if (method === "ping") return { response: response(id, {}) };
    if (method === "tools/list") {
      return { response: response(id, { tools: this.tools() }) };
    }
    if (method === "resources/list") return { response: response(id, { resources: [] }) };
    if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      const input = params.arguments ?? {};
      const tool = this.tools().find((candidate) => candidate.name === name);
      if (!tool) return { response: rpcError(id, -32602, `unknown tool: ${name}`) };
      try {
        const value = await tool.execute(input);
        return {
          response: response(id, {
            content: [{ type: "text", text: serialize(value) }],
            structuredContent: value,
          }),
        };
      } catch (error) {
        const details = errorInfo(error);
        return {
          response: response(id, {
            isError: true,
            content: [{ type: "text", text: serialize({ ok: false, error: details }) }],
            structuredContent: { ok: false, error: details },
          }),
        };
      }
    }
    if (method === "logging/setLevel") return { response: response(id, {}) };
    if (!method) return { response: rpcError(id, -32600, "method is required") };
    return { response: rpcError(id, -32601, `method not found: ${method}`) };
  }

  private tools(): McpTool[] {
    const common = CORE_TOOL_SPECS.flatMap((entry) => {
      const operation = this.operationById.get(entry.operationId);
      if (!operation) return [];
      return [{
        name: entry.name,
        description: `${entry.description} Risk: ${operation.risk}.`,
        inputSchema: entry.inputSchema,
        execute: async (raw: unknown) => {
          const input = asObject(raw);
          if (operation.risk === "dangerous" && input.confirm !== true) {
            throw Object.assign(new Error(`confirm=true is required for ${operation.id}`), { code: "CONFIRMATION_REQUIRED" });
          }
          return this.invokeOperation(operation, entry.toArgs(input));
        },
      } satisfies McpTool];
    });
    const generic: McpTool = {
      name: "pi_desktop_invoke",
      description: "Invoke any reviewed PI-Desktop operation. Use pi_control_describe to inspect operation ids and argument conventions. Dangerous operations require confirm=true.",
      inputSchema: objectSchema({
        operation: {
          type: "string",
          enum: this.operations.map((operation) => operation.id),
          description: "IPC operation path, for example session/create or project/set.",
        },
        args: {
          type: "array",
          items: anySchema(),
          description: "Positional IPC arguments in the renderer API order.",
        },
        confirm: booleanSchema("Required acknowledgement for dangerous operations."),
      }, ["operation"]),
      execute: async (raw) => {
        const input = asObject(raw);
        const operationId = typeof input.operation === "string" ? input.operation : "";
        const operation = this.operationById.get(operationId);
        if (!operation) throw Object.assign(new Error(`operation is not exposed: ${operationId}`), { code: "NOT_FOUND" });
        const args = input.args === undefined ? [] : input.args;
        if (!Array.isArray(args)) throw Object.assign(new Error("args must be an array"), { code: "INVALID_PARAMS" });
        if (args.length > MAX_ARGUMENT_ITEMS) throw Object.assign(new Error("too many IPC arguments"), { code: "INVALID_PARAMS" });
        if (operation.risk === "dangerous" && input.confirm !== true) {
          throw Object.assign(new Error(`confirm=true is required for ${operation.id}`), { code: "CONFIRMATION_REQUIRED" });
        }
        const result = await this.invokeOperation(operation, args);
        return { operation: operation.id, result };
      },
    };
    const describe: McpTool = {
      name: "pi_control_describe",
      description: "Return the reviewed PI-Desktop operation catalog.",
      inputSchema: objectSchema({}),
      execute: async () => this.operations.map((operation) => ({
        id: operation.id,
        risk: operation.risk,
        description: operation.description,
        argumentShape: operation.id === "session/rename"
          ? ["sessionId", "title"]
          : operation.id === "project/set"
            ? ["path"]
            : operation.id === "agent/getStatus"
              ? ["sessionId"]
              : "renderer IPC arguments; use the corresponding pi_* tool when available",
      })),
    };
    return [generic, describe, ...common];
  }

  private async invokeOperation(operation: McpControlOperation, args: readonly unknown[]): Promise<unknown> {
    const result = await this.invoke(operation.channel, args);
    await this.onOperationComplete?.(operation, result, args);
    return result;
  }

  private sessionId(request: IncomingMessage): string | null {
    const value = request.headers["mcp-session-id"];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private readJson(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > MAX_REQUEST_BYTES) {
          reject(new Error("MCP request exceeds 2 MiB"));
          request.destroy();
          return;
        }
        chunks.push(buffer);
      });
      request.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
      request.on("error", reject);
    });
  }

  private sendHttp(
    result: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void {
    result.writeHead(status, { "Content-Type": "application/json", ...headers });
    result.end(JSON.stringify(body));
  }

  private sendJsonRpc(
    result: ServerResponse,
    body: JsonRpcResponse,
    headers: Record<string, string> = {},
  ): void {
    result.writeHead(200, { "Content-Type": "application/json", ...headers });
    result.end(JSON.stringify(body));
  }
}

export const MCP_CONTROL_DEFAULT_PORT = DEFAULT_PORT;
