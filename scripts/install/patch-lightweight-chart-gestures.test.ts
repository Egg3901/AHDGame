import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { patchLightweightChartGestures } from "./patch-lightweight-chart-gestures.mjs";

const require = createRequire(import.meta.url);
const installed = dirname(require.resolve("lightweight-charts/package.json"));
const roots: string[] = [];
const files = ["lightweight-charts.development.mjs", "lightweight-charts.production.mjs"];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ahd-chart-gesture-patch-"));
  roots.push(root);
  mkdirSync(join(root, "dist"));
  copyFileSync(join(installed, "package.json"), join(root, "package.json"));
  for (const file of files) copyFileSync(join(installed, "dist", file), join(root, "dist", file));
  return root;
}

interface TimeScale {
  _internal_startScroll(x: number): void;
  _internal_startScale(x: number): void;
  _internal_scaleTo(x: number): void;
  _internal_endScale(): void;
  _private__scaleStartPoint: number | null;
  _private__scrollStartPoint: number | null;
  _private__commonTransitionStartState: unknown;
}

/** Execute the actual library class, with only rendering and data access stubbed. */
function timeScale(root: string, production: boolean) {
  const source = readFileSync(join(root, "dist", files[production ? 1 : 0]), "utf8")
    .replace(/^import .*?;\n/gm, "")
    .replace(/^export .*?;\n/gm, "")
    .replace(/import\{[^}]+\}from"fancy-canvas";/, "")
    .replace(/export\{[^}]+\};/, "");
  const context: { TimeScale?: { prototype: TimeScale } } = {};
  runInNewContext(source + `\nglobalThis.TimeScale = ${production ? "Fi" : "TimeScale"};`, context);
  const spacings: number[] = [];
  const scale: TimeScale = Object.assign(Object.create(context.TimeScale!.prototype), {
    _private__scaleStartPoint: null,
    _private__scrollStartPoint: null,
    _private__commonTransitionStartState: null,
    _private__width: 300,
    _internal_isEmpty: () => false,
    _internal_barSpacing: () => 6,
    _internal_rightOffset: () => 0,
    _internal_setBarSpacing: (value: number) => spacings.push(value),
  });
  if (production) {
    // The audited production bundle uses these names for the same class.
    const bundled = Object.assign(Object.create(context.TimeScale!.prototype), {
      yo: null,
      Po: null,
      nc: null,
      k_: 300,
      Zi: () => false,
      ml: () => 6,
      Oc: () => 0,
      Ms: (value: number) => spacings.push(value),
    });
    scale._internal_startScroll = (x) => bundled.f_(x);
    scale._internal_startScale = (x) => bundled.u_(x);
    scale._internal_scaleTo = (x) => bundled.c_(x);
    scale._internal_endScale = () => bundled.d_();
    Object.defineProperties(scale, {
      _private__scrollStartPoint: { get: () => bundled.Po },
      _private__scaleStartPoint: { get: () => bundled.yo },
      _private__commonTransitionStartState: { get: () => bundled.nc },
    });
  }
  return { scale, spacings };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.each([false, true])("pinned chart gesture compatibility (production=%s)", (production) => {
  it.each([0, 1, 120])("transitions a pan starting at %s into axis scaling", (start) => {
    const root = fixture();
    patchLightweightChartGestures(root);
    const { scale, spacings } = timeScale(root, production);
    scale._internal_startScroll(start);
    scale._internal_startScale(100);
    expect(() => scale._internal_scaleTo(150)).not.toThrow();
    expect(scale._private__scrollStartPoint).toBeNull();
    expect(scale._private__scaleStartPoint).toBe(100);
    expect(spacings).toEqual([4.5]);
    scale._internal_endScale();
    expect(scale._private__commonTransitionStartState).toBeNull();
  });

  it("keeps both modes idempotent across repeated installations", () => {
    const root = fixture();
    patchLightweightChartGestures(root);
    const first = files.map((file) => readFileSync(join(root, "dist", file), "utf8"));
    patchLightweightChartGestures(root);
    expect(files.map((file) => readFileSync(join(root, "dist", file), "utf8"))).toEqual(first);
  });

  it("validates every mode before writing and rejects unreviewed versions", () => {
    const root = fixture();
    const development = join(root, "dist", files[0]);
    const original = readFileSync(development, "utf8");
    const production = join(root, "dist", files[1]);
    writeFileSync(production, readFileSync(production, "utf8") + "\n// changed\n");
    expect(() => patchLightweightChartGestures(root)).toThrow("reviewed source");
    expect(readFileSync(development, "utf8")).toBe(original);
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "5.2.2" }));
    expect(() => patchLightweightChartGestures(root)).toThrow("Review or remove");
  });
});
