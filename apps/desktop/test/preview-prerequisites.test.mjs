import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkPreview } from "../../../scripts/check-preview.mjs";

test("preview checks actual build paths without importing or repairing Electron", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-preview-"));
  const put = (path, body = "") => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  try {
    for (const path of ["main/index.js", "main/plugin-host-process.js", "preload/index.cjs",
      "preload/plugin-panel.js", "renderer/index.html"]) put(`apps/desktop/out/${path}`);
    put("apps/desktop/package.json", "{}");
    put("packages/agent-runtime/dist/sidecar.js");
    put("target/debug/pi-desktop-host-core.exe");
    const electron = "apps/desktop/node_modules/electron";
    put(`${electron}/package.json`, '{"main":"index.js"}');
    put(`${electron}/index.js`, 'throw new Error("must not import Electron");');
    put(`${electron}/path.txt`, "electron.exe");
    assert.equal(checkPreview(root, {}, "win32").filter((c) => !c.ok).length, 1);
    put(`${electron}/dist/electron.exe`);
    assert.ok(checkPreview(root, {}, "win32").every((c) => c.ok));
    rmSync(join(root, "packages/agent-runtime/dist/sidecar.js"));
    put("packages/agent-runtime/dist-bundle/sidecar.js");
    assert.match(checkPreview(root, {}, "win32").find((c) => !c.ok).path, /dist[\\/]sidecar.js$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
