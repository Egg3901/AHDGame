/**
 * Lightweight Charts 5.2.1 treats a pan starting at coordinate zero as absent.
 * A concurrent time-axis touch then scales with a null start point. Preserve
 * both gestures by ending every active pan, including one starting at zero.
 * Review or remove this Apache-2.0 dependency compatibility patch on upgrades.
 * https://github.com/tradingview/lightweight-charts/blob/v5.2.1/src/model/time-scale.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const patches = [
  {
    file: "lightweight-charts.development.mjs",
    hash: "350786b76b81fd99d2fd4f782ad9a35747883cce3c2671d0b35eade8b397a4ae",
    before: "        if (this._private__scrollStartPoint) {\n",
    after: "        if (this._private__scrollStartPoint !== null) {\n",
  },
  {
    file: "lightweight-charts.production.mjs",
    hash: "faf0924968b1cbb9ea5bb6baa43a27ed6a0802341c07238b72ae869ffebab90c",
    before: "u_(t){this.Po&&this.v_(),",
    after: "u_(t){null!==this.Po&&this.v_(),",
  },
];

export function patchLightweightChartGestures(packageRoot) {
  const version = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
  if (version !== "5.2.1")
    throw new Error(
      `Review or remove the chart gesture compatibility patch for version ${version}`
    );
  // Validate both bundled modes before modifying either one.
  const plans = patches.map(({ file, hash, before, after }) => {
    const path = join(packageRoot, "dist", file);
    const source = readFileSync(path, "utf8");
    const original = source.includes(after) ? source.replace(after, before) : source;
    if (
      createHash("sha256").update(original).digest("hex") !== hash ||
      original.split(before).length !== 2
    )
      throw new Error("Chart gesture compatibility patch does not match the reviewed source");
    return { path, source, patched: original.replace(before, after) };
  });
  for (const { path, source, patched } of plans)
    if (source !== patched) writeFileSync(path, patched);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  patchLightweightChartGestures(dirname(require.resolve("lightweight-charts/package.json")));
  console.info("Chart gesture compatibility patch verified (5.2.1)");
}
