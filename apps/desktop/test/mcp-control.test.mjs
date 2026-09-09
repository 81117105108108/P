import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { McpControlServer } = await import("../electron/main/mcp-control.ts");

async function post(url, token, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  return {
    response,
    body: raw ? JSON.parse(raw) : null,
  };
}

test("local MCP control server authenticates, discovers, and invokes desktop operations", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "pi-mcp-control-"));
  const calls = [];
  const server = new McpControlServer({
    dataDir,
    port: 0,
    channels: {
      appGetVersion: "pi-desktop/app/getVersion",
      pluginLauncherToggle: "pi-desktop/pluginLauncher/toggle",
      projectSet: "pi-desktop/project/set",
      sessionDelete: "pi-desktop/session/delete",
      plansResolve: "pi-desktop/plans/resolve",
    },
    invoke: async (channel, args) => {
      calls.push({ channel, args });
      if (channel === "pi-desktop/app/getVersion") {
        return { name: "PI-Desktop", version: "test" };
      }
      if (channel === "pi-desktop/project/set") {
        return { workspace: { path: args[0], name: "fixture" } };
      }
      return { ok: true };
    },
  });
  t.after(() => server.stop());

  const info = await server.start();
  assert.ok(info);
  assert.match(info.url, /127\.0\.0\.1:\d+\/mcp$/);
  assert.match(info.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, "mcp-control.json"), "utf8")), info);

  const unauthorized = await fetch(info.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(unauthorized.status, 401);

  const rejectedOrigin = await fetch(info.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${info.token}`,
      Origin: "https://attacker.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const getResponse = await fetch(info.url, {
    headers: { Authorization: `Bearer ${info.token}` },
  });
  assert.equal(getResponse.status, 405);

  const initialized = await post(info.url, info.token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.body.result.serverInfo.name, "pi-desktop");
  const sessionId = initialized.response.headers.get("mcp-session-id");
  assert.ok(sessionId);

  const missingSession = await post(info.url, info.token, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  assert.equal(missingSession.response.status, 400);

  const unsupportedVersion = await post(
    info.url,
    info.token,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { "Mcp-Session-Id": sessionId, "MCP-Protocol-Version": "2099-01-01" },
  );
  assert.equal(unsupportedVersion.response.status, 400);

  const listed = await post(
    info.url,
    info.token,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { "Mcp-Session-Id": sessionId },
  );
  const toolNames = listed.body.result.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("pi_desktop_invoke"));
  assert.ok(toolNames.includes("pi_control_describe"));
  assert.ok(toolNames.includes("pi_project_open"));
  assert.ok(toolNames.includes("pi_plans_resolve"));

  const opened = await post(
    info.url,
    info.token,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "pi_project_open", arguments: { path: "/tmp/project" } },
    },
    { "Mcp-Session-Id": sessionId },
  );
  assert.equal(opened.body.result.structuredContent.workspace.path, "/tmp/project");
  assert.deepEqual(calls.at(-1), {
    channel: "pi-desktop/project/set",
    args: ["/tmp/project"],
  });

  const version = await post(
    info.url,
    info.token,
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "pi_desktop_invoke",
        arguments: { operation: "app/getVersion", args: [] },
      },
    },
    { "Mcp-Session-Id": sessionId },
  );
  assert.equal(version.body.result.structuredContent.result.version, "test");

  const refusedDelete = await post(
    info.url,
    info.token,
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "pi_desktop_invoke",
        arguments: { operation: "session/delete", args: ["session-1"] },
      },
    },
    { "Mcp-Session-Id": sessionId },
  );
  assert.equal(refusedDelete.body.result.isError, true);
  assert.equal(calls.some((call) => call.channel === "pi-desktop/session/delete"), false);

  await post(
    info.url,
    info.token,
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "pi_desktop_invoke",
        arguments: {
          operation: "session/delete",
          args: ["session-1"],
          confirm: true,
        },
      },
    },
    { "Mcp-Session-Id": sessionId },
  );
  assert.equal(calls.at(-1).channel, "pi-desktop/session/delete");

  const refusedPlan = await post(
    info.url,
    info.token,
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "pi_plans_resolve",
        arguments: {
          proposalId: "proposal-1",
          sessionId: "session-1",
          turnId: "turn-1",
          toolCallId: "tool-1",
          action: "reject",
        },
      },
    },
    { "Mcp-Session-Id": sessionId },
  );
  assert.equal(refusedPlan.body.result.isError, true);
  assert.equal(calls.some((call) => call.channel === "pi-desktop/plans/resolve"), false);

  await post(
    info.url,
    info.token,
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "pi_plans_resolve",
        arguments: {
          proposalId: "proposal-1",
          sessionId: "session-1",
          turnId: "turn-1",
          toolCallId: "tool-1",
          action: "reject",
          confirm: true,
        },
      },
    },
    { "Mcp-Session-Id": sessionId },
  );
  assert.deepEqual(calls.at(-1), {
    channel: "pi-desktop/plans/resolve",
    args: [{
      proposalId: "proposal-1",
      sessionId: "session-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      action: "reject",
    }],
  });

  const described = await post(
    info.url,
    info.token,
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "pi_control_describe", arguments: {} } },
    { "Mcp-Session-Id": sessionId },
  );
  const describedIds = described.body.result.structuredContent.map((entry) => entry.id);
  assert.equal(describedIds.includes("pluginLauncher/toggle"), true);
  assert.equal(describedIds.some((id) => id.startsWith("secrets/")), false);

  const notification = await post(
    info.url,
    info.token,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { "Mcp-Session-Id": sessionId },
  );
  assert.equal(notification.response.status, 202);

  const deleted = await fetch(info.url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${info.token}`, "Mcp-Session-Id": sessionId },
  });
  assert.equal(deleted.status, 204);
});

test("the MCP control connection file is marked inactive on shutdown", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pi-mcp-control-stop-"));
  const server = new McpControlServer({
    dataDir,
    port: 0,
    channels: { appGetVersion: "pi-desktop/app/getVersion" },
    invoke: async () => ({}),
  });
  const info = await server.start();
  await server.stop();
  const stopped = JSON.parse(readFileSync(join(dataDir, "mcp-control.json"), "utf8"));
  assert.equal(stopped.active, false);
  assert.equal(stopped.url, info.url);
});
