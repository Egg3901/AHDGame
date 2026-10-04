import { createRequire } from "node:module";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { verifyBracesDepth, verifyInstalledBracesDepth } from "./verify-braces-depth.mjs";

const require = createRequire(import.meta.url);
const braces = require("braces");
const micromatch = require("micromatch");
const glob = require("fast-glob");
const installed = dirname(require.resolve("braces/package.json"));
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ahd-braces-depth-"));
  roots.push(root);
  cpSync(installed, root, { recursive: true });
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const nested = (depth: number, open = "{", close = "}") =>
  open.repeat(depth) + "a,b" + close.repeat(depth);

describe("installed braces depth protection", () => {
  it("installs the security fork for the actual micromatch consumer", () => {
    const consumerRequire = createRequire(require.resolve("micromatch"));
    expect(consumerRequire("braces/package.json")).toMatchObject({
      name: "@lakeside/braces-depth-guard",
      version: "3.0.3-ahd.1",
    });
    expect(consumerRequire("braces/upstream.json").revision).toBe(
      "28d440b5dd449dbf1fe6f3506cf94ecca4d02660"
    );
  });

  it("rejects the advisory input before exhausting the call stack", () => {
    for (const run of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      expect(() => run(nested(4500))).toThrow(/Input depth.*exceeds max depth/);
    }
  });

  it.each(["{", "("])("bounds %s nesting at 100 including unclosed input", (open) => {
    const close = open === "{" ? "}" : ")";
    expect(() => braces.compile(nested(100, open, close))).not.toThrow();
    expect(() => braces.compile(nested(101, open, close))).toThrow(/max depth \(100\)/);
    expect(() => braces.parse(open.repeat(101))).toThrow(/max depth \(100\)/);
  });

  it("counts mixed nesting and respects stricter fractional limits", () => {
    expect(() => braces.parse("{(a,b)}", { maxDepth: 1 })).toThrow(/max depth \(1\)/);
    expect(() => braces.parse("{{a,b},c}", { maxDepth: 1.5 })).toThrow(/max depth \(1.5\)/);
    expect(() => braces.parse("((a,b),c)", { maxDepth: 1.5 })).toThrow(/max depth \(1.5\)/);
    expect(() => braces.parse(nested(101), { maxDepth: 10000 })).toThrow(/max depth \(100\)/);
    expect(() => braces.parse(nested(101), { maxDepth: Infinity })).toThrow(/max depth \(100\)/);
  });

  it("does not count escaped, quoted or bracket-literal braces", () => {
    for (const pattern of [
      "\\{".repeat(200),
      '"' + "{".repeat(200) + '"',
      "[" + "{".repeat(200) + "]",
    ]) {
      expect(() => braces.parse(pattern)).not.toThrow();
    }
  });

  it("guards direct AST entry points that bypass parsing", () => {
    for (const method of ["compile", "expand", "stringify"]) {
      let ast: { type: string; nodes?: unknown[]; value?: string } = { type: "text", value: "a" };
      for (let i = 0; i < 101; i++) ast = { type: "paren", nodes: [ast] };
      expect(() => braces[method]({ type: "root", nodes: [ast] })).toThrow(
        /AST depth.*exceeds max depth/
      );
    }
  });

  it.each(["compile", "expand", "stringify"])("honors AST depth boundaries in %s", (method) => {
    const ast = (depth: number) => {
      let node: { type: string; nodes?: unknown[]; value?: string } = { type: "text", value: "a" };
      for (let i = 0; i < depth; i++) node = { type: "paren", nodes: [node] };
      return { type: "root", nodes: [node] };
    };
    expect(() => braces[method](ast(100))).not.toThrow();
    expect(() => braces[method](ast(101))).toThrow(/max depth \(100\)/);
    expect(() => braces[method](ast(2), { maxDepth: 1.5 })).toThrow(/max depth \(1.5\)/);
    expect(() => braces[method](ast(101), { maxDepth: 10000 })).toThrow(/max depth \(100\)/);
  });

  it.each([false, true])("rejects cyclic expansion parent chains (multiple: %s)", (multiple) => {
    const ast: { type: string; nodes: unknown[]; parent?: unknown } = {
      type: "paren",
      nodes: [{ type: "text", value: "a" }],
    };
    ast.parent = multiple ? { type: "paren", parent: ast } : ast;
    expect(() =>
      runInNewContext("expand(ast)", { expand: braces.expand, ast }, { timeout: 250 })
    ).toThrow(/parent chain contains a cycle/);
  });

  it.each(["{{a}}", "{a,{b}}", "{{x}y}", "{a,{b,{c}}", "{}{a}"])(
    "preserves escapeInvalid output for %s",
    (pattern) => {
      expect(braces.stringify(braces.parse(pattern), { escapeInvalid: true })).toBe(pattern);
    }
  );

  it("preserves brace alternatives and ranges through the installed glob consumers", () => {
    expect(micromatch(["a.ts", "b.tsx", "c.js"], "*.{ts,tsx}")).toEqual(["a.ts", "b.tsx"]);
    expect(braces.expand("file{1..3}.{ts,tsx}")).toEqual([
      "file1.ts",
      "file1.tsx",
      "file2.ts",
      "file2.tsx",
      "file3.ts",
      "file3.tsx",
    ]);
    expect(glob.globSync("scripts/{install,changelog}", { onlyDirectories: true }).sort()).toEqual([
      "scripts/changelog",
      "scripts/install",
    ]);
    expect(() => micromatch.braces(nested(4500))).toThrow(/max depth/);
    expect(() => glob.globSync(nested(4500))).toThrow(/max depth/);
  });
});

describe("reviewed braces security fork", () => {
  it("verifies the source without rewriting any files", () => {
    const root = fixture();
    const snapshot = () =>
      ["constants", "parse", "compile", "expand", "stringify"].map((file) =>
        readFileSync(join(root, "lib", file + ".js"), "utf8")
      );
    verifyBracesDepth(root);
    const first = snapshot();
    verifyBracesDepth(root);
    expect(snapshot()).toEqual(first);
  });

  it("rejects modified sources without rewriting any files", () => {
    const root = fixture();
    const constantsPath = join(root, "lib/constants.js");
    const constants = readFileSync(constantsPath, "utf8").replace("  MAX_DEPTH: 100,\n", "");
    writeFileSync(constantsPath, constants);
    const path = join(root, "lib/stringify.js");
    writeFileSync(path, readFileSync(path, "utf8") + "\n// unreviewed change\n");
    expect(() => verifyBracesDepth(root)).toThrow("reviewed package source");
    expect(readFileSync(constantsPath, "utf8")).toBe(constants);
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "3.0.4" }));
    expect(() => verifyBracesDepth(root)).toThrow("Review or replace");
  });

  it("checks root and nested lockfile copies and allows production-only omission", () => {
    const project = mkdtempSync(join(tmpdir(), "ahd-braces-install-"));
    roots.push(project);
    const paths = ["node_modules/braces", "node_modules/tool/node_modules/braces"];
    writeFileSync(
      join(project, "package-lock.json"),
      JSON.stringify({
        packages: Object.fromEntries(paths.map((path) => [path, { version: "3.0.3" }])),
      })
    );
    expect(verifyInstalledBracesDepth(project)).toBe(0);
    for (const path of paths) cpSync(installed, join(project, path), { recursive: true });
    expect(verifyInstalledBracesDepth(project)).toBe(2);
    expect(verifyInstalledBracesDepth(project)).toBe(2);
  });
});
