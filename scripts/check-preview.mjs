import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isFile = (path) => {
  try { return statSync(path).isFile(); } catch { return false; }
};

// Never require("electron"): recent releases download on import when absent.
export function checkPreview(repo = root, env = process.env, platform = process.platform) {
  const desktop = join(repo, "apps/desktop");
  const checks = [
    "out/main/index.js",
    "out/main/plugin-host-process.js",
    "out/preload/index.cjs",
    "out/preload/plugin-panel.js",
    "out/renderer/index.html",
  ].map((path) => ({ path: join(desktop, path), ok: isFile(join(desktop, path)) }));
  const sidecar = join(repo, "packages/agent-runtime/dist/sidecar.js");
  checks.push({ path: sidecar, ok: isFile(sidecar) });
  const exe = platform === "win32" ? ".exe" : "";
  const hosts = [env.PI_DESKTOP_HOST_BIN,
    join(repo, `target/debug/pi-desktop-host-core${exe}`),
    join(repo, `target/release/pi-desktop-host-core${exe}`)].filter(Boolean);
  checks.push({ path: hosts.find(isFile) ?? hosts[0], ok: hosts.some(isFile) });
  try {
    const require = createRequire(join(desktop, "package.json"));
    const electronDir = dirname(require.resolve("electron/package.json"));
    let relative;
    try { relative = readFileSync(join(electronDir, "path.txt"), "utf8").trim(); } catch {}
    const binary = env.ELECTRON_OVERRIDE_DIST_PATH
      ? join(env.ELECTRON_OVERRIDE_DIST_PATH, relative || "electron")
      : relative ? join(electronDir, "dist", relative) : join(electronDir, "path.txt");
    checks.push({ path: binary, ok: Boolean(relative || env.ELECTRON_OVERRIDE_DIST_PATH) && isFile(binary) });
  } catch (error) {
    checks.push({ path: `Electron: ${error.message}`, ok: false });
  }
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const checks = checkPreview();
  for (const check of checks) console.log(`${check.ok ? "OK" : "MISSING"} ${check.path}`);
  if (checks.some((check) => !check.ok)) {
    console.error("Preview prerequisites missing. Build JS with pnpm build:js and host-core with cargo build -p host-core. Restore Electron separately if missing; this check never installs or removes it.");
    process.exitCode = 1;
  }
}
