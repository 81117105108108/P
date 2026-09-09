import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const main = readFileSync(join(desktopRoot, "electron/main/index.ts"), "utf8");
const app = readFileSync(join(desktopRoot, "src/App.tsx"), "utf8");
const api = readFileSync(join(desktopRoot, "src/lib/api.ts"), "utf8");

test("the optional MCP control server reuses IPC and synchronizes renderer state", () => {
  assert.match(main, /const invokeIpc = registerIpc\(\)/);
  assert.match(main, /process\.env\.PI_DESKTOP_MCP_CONTROL === "1"/);
  assert.match(main, /channels: IPC\.invoke/);
  assert.match(main, /process\.env\.PI_DESKTOP_MCP_PORT/);
  assert.match(main, /mcpControl\?\.stop\(\)/);
  assert.match(api, /projectPath\?: string \| null/);
  assert.match(api, /selectSessionId\?: string/);
  assert.match(app, /event\.projectPath/);
  assert.match(app, /event\.selectSessionId/);
  assert.match(app, /openProjectPath\(event\.projectPath\)/);
});
