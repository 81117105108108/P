import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifyScript = new URL(
  "../../../scripts/verify-macos-release.sh",
  import.meta.url,
);

test("macOS release verification requires a notarized Developer ID app and DMG", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-macos-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const release = join(root, "release");
  const app = join(release, "mac-arm64", "PI-Desktop.app");
  const bin = join(root, "bin");
  await mkdir(app, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(release, "PI-Desktop-0.14.2-arm64.dmg"), "fixture");
  await writeFile(
    join(bin, "codesign"),
    "#!/usr/bin/env bash\nif [[ \"$*\" == *\"-dv\"* ]]; then echo 'Authority=Developer ID Application: PI-Desktop (TEAM123)' >&2; fi\nexit 0\n",
  );
  await writeFile(
    join(bin, "spctl"),
    "#!/usr/bin/env bash\necho 'source=Notarized Developer ID' >&2\n",
  );
  await writeFile(
    join(bin, "xcrun"),
    "#!/usr/bin/env bash\n[[ \"$1 $2\" == 'stapler validate' ]]\n",
  );
  await Promise.all(
    ["codesign", "spctl", "xcrun"].map((name) => chmod(join(bin, name), 0o755)),
  );

  const result = spawnSync("bash", [verifyScript.pathname, release], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Notarized Developer ID/);
  assert.match(result.stdout, /PI-Desktop-0\.14\.2-arm64\.dmg/);
});
