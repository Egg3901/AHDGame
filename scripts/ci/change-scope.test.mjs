import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const step = workflow
  .split("      - name: Classify the change\n")[1]
  .split("\n  content-checks:")[0];
const script = step.split("        run: |\n")[1].replace(/^          /gm, "");
const expression = step.match(/EMPTY_BACK_MERGE: \$\{\{ (.*) \}\}/)?.[1];
function context({
  event = "pull_request",
  head = "main",
  base = "development",
  headRepo = 9,
  baseRepo = 9,
} = {}) {
  return {
    event_name: event,
    head_ref: head,
    base_ref: base,
    event: {
      repository: { id: 9 },
      pull_request: { head: { repo: { id: headRepo } }, base: { repo: { id: baseRepo } } },
    },
  };
}
function eligible(github) {
  return expression ? String(Function("github", `return (${expression});`)(github)) : "false";
}
function classify({
  files = [],
  status = 0,
  partial = true,
  github = context(),
  env = {},
  missingParent = false,
  rename = false,
  deleted = false,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "change-scope-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git("init", "-q");
    git("config", "user.email", "ci-fixture");
    git("config", "user.name", "CI fixture");
    writeFileSync(join(dir, "code.js"), "code");
    git("add", ".");
    git("commit", "-qm", "parent");
    if (!missingParent) {
      for (const path of files) {
        mkdirSync(join(dir, path, ".."), { recursive: true });
        writeFileSync(join(dir, path), "changed");
      }
      if (rename) git("mv", "code.js", "README.md");
      if (deleted) rmSync(join(dir, "code.js"));
      git("add", "-A");
      git("commit", "--allow-empty", "-qm", "head");
    }
    const bin = join(dir, "bin");
    mkdirSync(bin);
    if (status) {
      writeFileSync(
        join(bin, "git"),
        `#!/bin/bash\n${partial ? "printf 'docs/partial.md\\0'\n" : ""}exit ${status}\n`,
        { mode: 0o755 }
      );
    }
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: output,
        GITHUB_EVENT_NAME: github.event_name,
        EMPTY_BACK_MERGE: eligible(github),
        REUSE_QUALIFICATION: "false",
        CAN_REUSE: "false",
        PROMOTION: "false",
        ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(output, "utf8").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const base of ["development", "staging"]) {
  test(`empty same-repository main to ${base} uses content checks`, () => {
    assert.equal(classify({ github: context({ base }) }), "full_suite=false");
  });
}
test("empty eligibility expression requires the exact trusted context", () => {
  assert.ok(expression);
  for (const options of [
    { event: "push" },
    { head: "feature" },
    { base: "main" },
    { headRepo: 10 },
    { baseRepo: 10 },
    { headRepo: null },
    { baseRepo: null },
    { head: "" },
    { base: "" },
  ])
    assert.equal(eligible(context(options)), "false", JSON.stringify(options));
  assert.match(
    expression,
    /github\.event\.pull_request\.head\.repo\.id == github\.event\.repository\.id/
  );
  assert.match(
    expression,
    /github\.event\.pull_request\.base\.repo\.id == github\.event\.repository\.id/
  );
});
for (const [name, options, full] of [
  ["code", { files: ["src/code.ts"] }, true],
  ["content", { files: ["docs/guide.md", "README.md", "content/changelog/note.md"] }, false],
  ["failed diff with partial docs", { status: 128 }, true],
  ["failed diff without output", { status: 128, partial: false }, true],
  ["missing parent", { missingParent: true }, true],
  ["ordinary empty PR", { github: context({ head: "feature" }) }, true],
  ["fork empty PR", { github: context({ headRepo: 10 }) }, true],
  ["unknown empty PR", { github: context({ headRepo: null }) }, true],
  ["push", { github: context({ event: "push" }) }, true],
  ["promotion", { env: { PROMOTION: "true" } }, true],
  [
    "development to staging promotion",
    { github: context({ head: "development", base: "staging" }), env: { PROMOTION: "true" } },
    true,
  ],
  [
    "staging to main promotion",
    { github: context({ head: "staging", base: "main" }), env: { PROMOTION: "true" } },
    true,
  ],
  [
    "valid reuse before promotion gate",
    {
      files: ["code.ts"],
      env: { REUSE_QUALIFICATION: "true", CAN_REUSE: "true", PROMOTION: "true" },
    },
    false,
  ],
  ["invalid reuse before empty gate", { env: { REUSE_QUALIFICATION: "true" } }, true],
  ["code renamed to markdown", { rename: true }, true],
  ["deleted code", { deleted: true }, true],
  ["content whitespace and newline", { files: ["docs/a b\nc.md"] }, false],
  ["code whitespace and newline", { files: ["src/a b\nc.ts"] }, true],
  ["newline cannot split a code path into docs", { files: ["docs/a.md\ncode.ts"] }, true],
]) {
  test(name, () => assert.equal(classify(options), `full_suite=${full}`));
}
test("CI runs classifier regression tests with the existing script tests", () => {
  assert.match(
    workflow,
    /run: node --test scripts\/ci\/change-scope.test.mjs scripts\/ci\/staging-qualification.test.mjs scripts\/build-with-cache-recovery.test.mjs/
  );
});
