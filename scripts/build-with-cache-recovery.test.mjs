import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBuild } from "./build-with-cache-recovery.mjs";
import { clearCompilerCache } from "./clear-railway-build-cache.mjs";

const panic =
  "thread 'worker' panicked at turbopack/crates/turbo-persistence/src/static_sorted_file.rs:145:17:\nrange end index 123 out of range for slice of length 100";
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "compiler-cache-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  for (const kind of ["turbopack", "webpack", "fetch-cache"]) {
    mkdirSync(join(cwd, ".next/cache", kind), { recursive: true });
    writeFileSync(join(cwd, ".next/cache", kind, "marker"), "keep");
  }
  writeFileSync(
    join(cwd, "fake-build.cjs"),
    `
    const fs = require('node:fs');
    let n = Number(fs.existsSync('attempts') ? fs.readFileSync('attempts', 'utf8') : 0) + 1;
    fs.writeFileSync('attempts', String(n));
    if (process.env.FAIL === 'always' || (process.env.FAIL === 'first' && n === 1)) {
      process.stderr.write(process.env.DIAGNOSTIC);
      process.exit(7);
    }
    process.stdout.write('build complete');
  `
  );
  const invoke = (env = {}) =>
    runBuild({
      cwd,
      env: { ...process.env, RAILWAY_ENVIRONMENT_NAME: "test", ...env },
      args: [join(cwd, "fake-build.cjs")],
      stdout: { write() {} },
      stderr: { write() {} },
    });
  return {
    cwd,
    invoke,
    attempts: () => Number(readFileSync(join(cwd, "attempts"), "utf8")),
    marker: (kind) => existsSync(join(cwd, ".next/cache", kind, "marker")),
  };
}
test("successful Railway builds retain compiler and fetch caches", async (t) => {
  const h = fixture(t);
  assert.equal((await h.invoke()).code, 0);
  assert.equal(h.attempts(), 1);
  for (const kind of ["turbopack", "webpack", "fetch-cache"]) assert.equal(h.marker(kind), true);
});
test("verified persistence bounds panic gets one clean retry without touching fetch cache or mount points", async (t) => {
  const h = fixture(t);
  assert.equal((await h.invoke({ FAIL: "first", DIAGNOSTIC: panic })).code, 0);
  assert.equal(h.attempts(), 2);
  for (const kind of ["turbopack", "webpack"]) {
    assert.equal(h.marker(kind), false);
    assert.equal(existsSync(join(h.cwd, ".next/cache", kind)), true);
  }
  assert.equal(h.marker("fetch-cache"), true);
});
for (const diagnostic of [
  "Type error: incompatible assignment",
  "Turbopack panicked: unsupported module",
  "RangeError: Offset is outside the bounds of the DataView",
  "turbo-persistence: permission denied",
]) {
  test(`ordinary failure is not retried: ${diagnostic}`, async (t) => {
    const h = fixture(t);
    assert.equal((await h.invoke({ FAIL: "always", DIAGNOSTIC: diagnostic })).code, 7);
    assert.equal(h.attempts(), 1);
    assert.equal(h.marker("turbopack"), true);
  });
}
test("the second build failure stays failed and cannot trigger another retry", async (t) => {
  const h = fixture(t);
  assert.equal((await h.invoke({ FAIL: "always", DIAGNOSTIC: panic })).code, 7);
  assert.equal(h.attempts(), 2);
});
test("automatic recovery is limited to Railway", async (t) => {
  const h = fixture(t);
  assert.equal(
    (await h.invoke({ FAIL: "first", DIAGNOSTIC: panic, RAILWAY_ENVIRONMENT_NAME: "" })).code,
    7
  );
  assert.equal(h.attempts(), 1);
  assert.equal(h.marker("turbopack"), true);
});
test("explicit recovery clears compiler contents only", (t) => {
  const h = fixture(t);
  clearCompilerCache(h.cwd);
  assert.equal(h.marker("turbopack"), false);
  assert.equal(h.marker("webpack"), false);
  assert.equal(h.marker("fetch-cache"), true);
});

test("a signalled compiler is not retried even with a persistence diagnostic", async (t) => {
  const h = fixture(t);
  writeFileSync(
    join(h.cwd, "fake-build.cjs"),
    `process.stderr.write(${JSON.stringify(panic)}); process.kill(process.pid, 'SIGTERM');`
  );
  assert.equal((await h.invoke()).signal, "SIGTERM");
  assert.equal(h.marker("turbopack"), true);
});

test("missing compiler process fails without clearing cache", async (t) => {
  const h = fixture(t);
  await assert.rejects(
    runBuild({ cwd: h.cwd, command: join(h.cwd, "missing-command"), args: [] }),
    /ENOENT/
  );
  assert.equal(h.marker("turbopack"), true);
});

test("explicit recovery refuses symlinked compiler directories", async (t) => {
  const h = fixture(t);
  const { symlinkSync } = await import("node:fs");
  const outside = join(h.cwd, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "marker"), "keep");
  rmSync(join(h.cwd, ".next/cache/turbopack"), { recursive: true });
  symlinkSync(outside, join(h.cwd, ".next/cache/turbopack"));
  assert.throws(() => clearCompilerCache(h.cwd), /Not a compiler-cache directory/);
  assert.equal(existsSync(join(outside, "marker")), true);
});

for (const fail of ["never", "first", "always"]) {
  test(`npm build keeps postbuild after successful compilation only (${fail})`, async (t) => {
    const h = fixture(t);
    const { copyFileSync } = await import("node:fs");
    const { spawnSync } = await import("node:child_process");
    const project = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    writeFileSync(join(h.cwd, "package.json"), JSON.stringify({ scripts: project.scripts }));
    mkdirSync(join(h.cwd, "scripts"));
    for (const file of ["build-with-cache-recovery.mjs", "clear-railway-build-cache.mjs"]) {
      copyFileSync(new URL(file, import.meta.url), join(h.cwd, "scripts", file));
    }
    mkdirSync(join(h.cwd, "node_modules/next/dist/bin"), { recursive: true });
    copyFileSync(join(h.cwd, "fake-build.cjs"), join(h.cwd, "node_modules/next/dist/bin/next"));
    mkdirSync(join(h.cwd, "node_modules/.bin"), { recursive: true });
    writeFileSync(
      join(h.cwd, "node_modules/.bin/tsx"),
      "#!/usr/bin/env node\nrequire('node:fs').writeFileSync('postbuilt','yes');",
      { mode: 0o755 }
    );
    const result = spawnSync("npm", ["run", "build"], {
      cwd: h.cwd,
      env: { ...process.env, RAILWAY_ENVIRONMENT_NAME: "test", FAIL: fail, DIAGNOSTIC: panic },
      encoding: "utf8",
    });
    assert.equal(result.status, fail === "always" ? 7 : 0, result.stderr);
    assert.equal(h.attempts(), fail === "never" ? 1 : 2);
    assert.equal(h.marker("turbopack"), fail === "never");
    assert.equal(existsSync(join(h.cwd, "postbuilt")), fail !== "always");
    assert.equal(h.marker("fetch-cache"), true);
  });
}

test("cancelling the wrapper stays failed even when the compiler exits zero", async (t) => {
  const h = fixture(t);
  writeFileSync(
    join(h.cwd, "fake-build.cjs"),
    `
    const fs = require('node:fs');
    process.on('SIGTERM', () => process.exit(0));
    fs.writeFileSync('ready', 'yes');
    setTimeout(() => process.exit(9), 2000);
  `
  );
  const running = h.invoke();
  const deadline = Date.now() + 1500;
  while (!existsSync(join(h.cwd, "ready")) && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 10));
  assert.equal(existsSync(join(h.cwd, "ready")), true);
  process.emit("SIGTERM");
  const result = await running;
  assert.equal(result.code, null);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(h.marker("turbopack"), true);
});

test("the CLI forwards caller-supplied Next build flags", async (t) => {
  const h = fixture(t);
  const { spawnSync } = await import("node:child_process");
  mkdirSync(join(h.cwd, "node_modules/next/dist/bin"), { recursive: true });
  writeFileSync(
    join(h.cwd, "node_modules/next/dist/bin/next"),
    "require('node:fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(2))); "
  );
  const result = spawnSync(
    process.execPath,
    [
      new URL("./build-with-cache-recovery.mjs", import.meta.url).pathname,
      "--webpack",
      "--debug-prerender",
    ],
    { cwd: h.cwd, encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(h.cwd, "argv.json"), "utf8")), [
    "build",
    "--webpack",
    "--debug-prerender",
  ]);
  assert.equal(h.marker("turbopack"), true);
});
