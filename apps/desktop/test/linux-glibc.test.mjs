import assert from "node:assert/strict";
import test from "node:test";
import {
  GlibcUnsupportedError,
  LINUX_GLIBC_DISTROS,
  MIN_LINUX_GLIBC,
  assertLinuxGlibcSupported,
  formatGlibcVersion,
  glibcAtLeast,
  glibcMissingSymbol,
  isGlibcUnsupportedError,
  parseGlibcVersion,
  readRuntimeGlibcVersion,
} from "../electron/main/linux-glibc.ts";

test("glibc 2.39 is the packaged Linux floor", () => {
  assert.deepEqual(MIN_LINUX_GLIBC, { major: 2, minor: 39 });
  assert.match(LINUX_GLIBC_DISTROS, /Ubuntu 24\.04/);
  assert.match(LINUX_GLIBC_DISTROS, /Debian 13/);
  assert.match(LINUX_GLIBC_DISTROS, /Fedora 40\+/);
  assert.equal(glibcAtLeast({ major: 2, minor: 39 }, MIN_LINUX_GLIBC), true);
  assert.equal(glibcAtLeast({ major: 2, minor: 41 }, MIN_LINUX_GLIBC), true);
  assert.equal(glibcAtLeast({ major: 2, minor: 35 }, MIN_LINUX_GLIBC), false);
  assert.equal(glibcAtLeast({ major: 2, minor: 38 }, MIN_LINUX_GLIBC), false);
});

test("parseGlibcVersion reads ldd and loader output", () => {
  assert.deepEqual(
    parseGlibcVersion("ldd (Ubuntu GLIBC 2.39-0ubuntu8.4) 2.39"),
    { major: 2, minor: 39 },
  );
  assert.deepEqual(parseGlibcVersion("2.35"), { major: 2, minor: 35 });
  assert.equal(parseGlibcVersion("not a version"), null);
  assert.equal(formatGlibcVersion({ major: 2, minor: 39 }), "2.39");
});

test("GLIBC loader errors are recognized from stderr", () => {
  assert.equal(
    glibcMissingSymbol(
      "/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found",
    ),
    true,
  );
  assert.equal(glibcMissingSymbol("host-core exited"), false);
  assert.equal(
    isGlibcUnsupportedError(new GlibcUnsupportedError("2.35")),
    true,
  );
  assert.equal(
    isGlibcUnsupportedError(new Error("version `GLIBC_2.39' not found")),
    true,
  );
  assert.equal(isGlibcUnsupportedError(new Error("host-core exited")), false);
});

test("assertLinuxGlibcSupported throws only below the floor on Linux", () => {
  if (process.platform !== "linux") {
    assert.doesNotThrow(() =>
      assertLinuxGlibcSupported({ header: { glibcVersionRuntime: "2.35" } }),
    );
    return;
  }
  assert.doesNotThrow(() =>
    assertLinuxGlibcSupported({ header: { glibcVersionRuntime: "2.39" } }),
  );
  assert.throws(
    () => assertLinuxGlibcSupported({ header: { glibcVersionRuntime: "2.35" } }),
    GlibcUnsupportedError,
  );
  assert.deepEqual(
    readRuntimeGlibcVersion({ header: { glibcVersionRuntime: "2.41" } }),
    { major: 2, minor: 41 },
  );
});
