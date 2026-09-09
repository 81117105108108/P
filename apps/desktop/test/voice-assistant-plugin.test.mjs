import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, "../../../plugins/com.vastsa.voice-assistant");

test("standalone voice assistant declares identity and explicit grants", () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "com.vastsa.voice-assistant");
  assert.match(manifest.repository, /github\.com\/vastsa\/PI-Desktop$/);
  assert.equal(manifest.enabledByDefault, undefined);
  assert.equal(manifest.contributes.commands[0].id, "com.vastsa.voice-assistant.open");
  assert.deepEqual(manifest.permissions, [
    "ui.panel",
    "ui.microphone",
    "agent.complete",
    "models.list",
    "desktop.control",
  ]);
  const main = readFileSync(join(pluginRoot, "main.js"), "utf8");
  const panel = readFileSync(join(pluginRoot, "renderer/index.html"), "utf8");
  assert.match(main, /pi\.desktop\.listOperations/);
  assert.match(main, /pi\.desktop\.invoke/);
  assert.match(main, /confirmation/);
  assert.match(panel, /getUserMedia/);
  assert.match(panel, /SpeechRecognition/);
  assert.match(panel, /speechSynthesis/);
});

test("voice assistant routes a normal command and confirms a dangerous command", async () => {
  const calls = [];
  let route = {
    operation: "project/set",
    args: ["/tmp/voice-project"],
    reply: "正在打开项目",
  };
  globalThis.pi = {
    commands: {
      register: async () => {},
      unregister: async () => {},
    },
    plugin: {
      getSettings: async () => ({ modelKey: "provider/model", thinkingLevel: "low", speakReplies: true }),
      setSettings: async () => {},
    },
    models: {
      list: async () => [{ key: "provider/model", label: "Model" }],
    },
    agent: {
      complete: async () => ({ text: JSON.stringify(route) }),
    },
    desktop: {
      listOperations: async () => [
        { id: "project/set", description: "Open a project", risk: "write" },
        { id: "session/delete", description: "Delete a session", risk: "dangerous" },
        { id: "session/create", description: "Create a session", risk: "write" },
        { id: "agent/getStatus", description: "Read status", risk: "read" },
        { id: "session/get", description: "Read session", risk: "read" },
      ],
      invoke: async (input) => {
        calls.push(input);
        if (input.operation === "project/set") return { workspace: { path: input.args[0] } };
        if (input.operation === "session/create") return { session: { id: "s1" } };
        return { ok: true };
      },
    },
  };
  const modulePath = join(pluginRoot, "main.js");
  const plugin = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
  await plugin.onLoad();

  const normal = await plugin.onPanelInvoke("voice.get");
  assert.equal(normal.operationCount, 5);
  const opened = await plugin.onPanelInvoke("voice.route", { text: "打开项目" });
  assert.equal(opened.type, "answer");
  assert.deepEqual(calls.at(-1), {
    operation: "project/set",
    args: ["/tmp/voice-project"],
    confirm: false,
  });

  route = {
    operation: "session/delete",
    args: ["s1"],
    reply: "准备删除会话",
  };
  const confirmation = await plugin.onPanelInvoke("voice.route", { text: "删除会话" });
  assert.equal(confirmation.type, "confirmation");
  assert.equal(calls.some((input) => input.operation === "session/delete"), false);
  const confirmed = await plugin.onPanelInvoke("voice.confirm", { token: confirmation.token });
  assert.equal(confirmed.type, "answer");
  assert.deepEqual(calls.at(-1), {
    operation: "session/delete",
    args: ["s1"],
    confirm: true,
  });
  await plugin.onUnload();
  delete globalThis.pi;
});
