/**
 * Temporary depth-only backport for braces 3.0.3 (CVE-2026-93687).
 * Upstream has no patched release. Bound parsing and direct AST walkers without
 * changing ordinary matching or hiding the version-based audit finding.
 * Review or remove this patch when the dependency changes.
 * https://github.com/micromatch/braces/pull/72
 * Upstream portions are MIT licensed; see braces-depth.LICENSE.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maxDepth =
  "  const maxDepth = Number.isFinite(options.maxDepth) ? Math.min(MAX_DEPTH, options.maxDepth) : MAX_DEPTH;\n";
const walkGuard =
  "    if (node.nodes && depth > maxDepth) {\n" +
  "      throw new RangeError(`AST depth (${depth}), exceeds max depth (${maxDepth})`);\n" +
  "    }\n";
const nestingGuard =
  "      if (nesting + 1 > maxDepth) {\n" +
  "        throw new SyntaxError(`Input depth (${nesting + 1}), exceeds max depth (${maxDepth})`);\n" +
  "      }\n" +
  "      nesting++;\n";

const patches = [
  {
    file: "constants",
    hash: "c18ac5adb57308f1ce42a28552da3a31f5d83709743ebd9a636336813a744d4b",
    edits: [["module.exports = {\n", "module.exports = {\n  MAX_DEPTH: 100,\n"]],
  },
  {
    file: "parse",
    hash: "e572166565f15fa6ad9865ae49d678218e32aabfd1b3720f6d0d43d39800d310",
    edits: [
      ["  MAX_LENGTH,\n", "  MAX_DEPTH,\n  MAX_LENGTH,\n"],
      [
        "  if (input.length > max) {",
        maxDepth.replaceAll("options.", "opts.") + "  if (input.length > max) {",
      ],
      ["  let depth = 0;\n", "  let depth = 0;\n  let nesting = 0;\n"],
      [
        "    if (value === CHAR_LEFT_PARENTHESES) {\n",
        "    if (value === CHAR_LEFT_PARENTHESES) {\n" + nestingGuard,
      ],
      [
        "    if (value === CHAR_LEFT_CURLY_BRACE) {\n",
        "    if (value === CHAR_LEFT_CURLY_BRACE) {\n" + nestingGuard,
      ],
      [
        "      push({ type: 'text', value });\n      block = stack[stack.length - 1];",
        "      push({ type: 'text', value });\n      nesting--;\n      block = stack[stack.length - 1];",
      ],
      ["      depth--;\n", "      depth--;\n      nesting--;\n"],
    ],
  },
  ...[
    ["compile", "dc98f22eee3d511785d92a00758d5f0d48efed5f5813bdecc2de430c529b5c9f"],
    ["expand", "41ccc196ebfa7b7781a634e721eb744e4e7bcb54cba427a7e3d6806a1b9e58f7"],
    ["stringify", "379f22d77bfa1478341ccd49c5e4267464aabcbba03558bab332aac23fc6f23a"],
  ].map(([file, hash]) => {
    const walker = file === "stringify" ? "stringify" : "walk";
    const originalReturn = file === "expand" ? "utils.flatten(walk(ast))" : `${walker}(ast)`;
    const guardedReturn = `${walker}(ast, {}, ast.type === 'root' ? 0 : 1)`;
    return {
      file,
      hash,
      edits: [
        [
          "const utils = require('./utils');\n",
          "const utils = require('./utils');\nconst { MAX_DEPTH } = require('./constants');\n",
        ],
        [
          `  const ${walker} = (node, parent = {}) => {\n`,
          maxDepth + `\n  const ${walker} = (node, parent = {}, depth = 0) => {\n` + walkGuard,
        ],
        [
          file === "stringify" ? "stringify(child)" : "walk(child, node)",
          file === "stringify"
            ? "stringify(child, undefined, child.nodes ? depth + 1 : depth)"
            : "walk(child, node, child.nodes ? depth + 1 : depth)",
        ],
        [
          `return ${originalReturn};`,
          `return ${file === "expand" ? `utils.flatten(${guardedReturn})` : guardedReturn};`,
        ],
      ],
    };
  }),
];

const hash = (source) => createHash("sha256").update(source).digest("hex");
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("Braces depth patch does not match the reviewed package source");
  return source.replace(before, after);
}

function preparePatch(packageRoot) {
  const version = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
  if (version !== "3.0.3")
    throw new Error(`Review or remove the braces depth patch for version ${version}`);
  return patches.map((patch) => {
    const path = join(packageRoot, "lib", patch.file + ".js");
    const source = readFileSync(path, "utf8");
    let original = source;
    if (hash(original) !== patch.hash) {
      for (const [before, after] of [...patch.edits].reverse())
        original = replaceOnce(original, after, before);
      if (hash(original) !== patch.hash)
        throw new Error("Braces depth patch does not match the reviewed package source");
    }
    let patched = original;
    for (const [before, after] of patch.edits) patched = replaceOnce(patched, before, after);
    return { path, source, patched };
  });
}

function applyPatches(plans) {
  for (const { path, source, patched } of plans)
    if (source !== patched) writeFileSync(path, patched);
}

export function patchBracesDepth(packageRoot) {
  applyPatches(preparePatch(packageRoot));
}

export function patchInstalledBracesDepth(projectRoot) {
  const lock = JSON.parse(readFileSync(join(projectRoot, "package-lock.json"), "utf8"));
  const roots = Object.keys(lock.packages)
    .filter((path) => path === "node_modules/braces" || path.endsWith("/node_modules/braces"))
    .map((path) => join(projectRoot, path))
    // Development tooling is absent from production-only installations.
    .filter((path) => existsSync(join(path, "package.json")));
  // Validate every copy before modifying any installed source.
  applyPatches(roots.flatMap(preparePatch));
  return roots.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const count = patchInstalledBracesDepth(root);
  console.info(`Braces depth patch verified (${count} installed copies)`);
}
