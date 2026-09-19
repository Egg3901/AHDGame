/**
 * Deterministic dry-run for #1165 (regional demographic leans).
 *
 * Builds the shared granular electorate substrate for every US state at the
 * 1953 baseline plus the full Southern-realignment (Brown) overlay for the
 * Deep South, with no database, no clock, and no randomness: the only inputs
 * are the seed census/position tables and the authored checkpoint, so two
 * runs on the same tree are byte-identical.
 *
 * Usage:
 *   npx tsx scripts/sim/deepSouthElectorateDryRun.ts > scripts/sim/reports/deep-south-electorate-1165.md
 *   npx prettier --write scripts/sim/reports/deep-south-electorate-1165.md
 *
 * Covered by ./deepSouthElectorateDryRun.test.ts, which asserts the full
 * matrix: every census state (50 + DC) present, Deep South Black/white conditioned
 * electorates at 1953 and under Brown, non-Southern controls, economic-band
 * preservation, and pruning counterweight survival.
 */
import "@/lib/seeds/stateDemographics";
import type { Layer1PositionOverlay, StateDemographics } from "@/lib/db/types";
import {
  buildGranularElectorateSubstrate,
  clearGranularElectorateCache,
  ELECTORATE_REPRESENTATION_FRACTION,
  type GranularElectorateUnit,
} from "@/lib/demographics/granularElectorate";
import { SOUTHERN_REALIGNMENT_CHECKPOINT } from "@/lib/demographics/eraCheckpoints";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { conditionedOffsetsAtAnchor } from "@/lib/seeds/demographicCategories";

/** Deep South states carrying the 1953 Black-class correction. */
export const DRY_RUN_DEEP_SOUTH = ["AL", "MS", "SC", "LA", "GA", "AR"] as const;

export interface ConditionedMeans {
  share: number;
  econ: number;
  soc: number;
}

export interface StateDryRunRow {
  stateId: string;
  hasOffsets: boolean;
  black: ConditionedMeans | null;
  white: ConditionedMeans | null;
  blackBrown: ConditionedMeans | null;
  whiteBrown: ConditionedMeans | null;
  /** Minimum over present buckets of kept-mass / marginal. */
  minKeptRatio: number;
}

export interface DeepSouthDryRun {
  rows: StateDryRunRow[];
}

function stubDemographics(stateId: string): StateDemographics {
  return { _id: stateId, countryId: "US", groups: {} } as unknown as StateDemographics;
}

/** Full Southern-realignment checkpoint totals as a durable position overlay. */
export function dryRunBrownOverlay(): Layer1PositionOverlay {
  const out: Layer1PositionOverlay = {};
  for (const t of SOUTHERN_REALIGNMENT_CHECKPOINT.targets) {
    if (!t.dim || !t.bucket) continue;
    if (t.axis !== "economicLean" && t.axis !== "socialLean") continue;
    out[t.dim] ??= {};
    out[t.dim][t.bucket] ??= { economicLean: 0, socialLean: 0 };
    if (t.axis === "economicLean") out[t.dim][t.bucket]!.economicLean! += t.totalShift;
    else out[t.dim][t.bucket]!.socialLean! += t.totalShift;
  }
  return out;
}

function conditioned(units: GranularElectorateUnit[], bucketKey: string): ConditionedMeans | null {
  let w = 0;
  let e = 0;
  let s = 0;
  for (const u of units) {
    const bw = u.bucketWeights[bucketKey] ?? 0;
    if (bw <= 0) continue;
    w += u.share * bw;
    e += u.share * bw * u.economicLean;
    s += u.share * bw * u.socialLean;
  }
  if (w <= 0) return null;
  return { share: w, econ: e / w, soc: s / w };
}

function substrate(stateId: string, overlay?: Layer1PositionOverlay): GranularElectorateUnit[] {
  const demo = stubDemographics(stateId);
  clearGranularElectorateCache();
  const out = buildGranularElectorateSubstrate({
    countryId: "US",
    stateId,
    preset: "1953-default",
    turnoutDoc: null,
    statePopulation: 1_000_000,
    demographics: demo,
    categories: [],
    enriched: [],
    demographicDefaults: overlay ? { ...demo, layer1PositionOverrides: overlay } : null,
  });
  if (!out) throw new Error(`no substrate for ${stateId}`);
  return out.units;
}

/** Deterministic: pure function of the seed tables on a cleared cache. */
export function runDeepSouthDryRun(): DeepSouthDryRun {
  const brown = dryRunBrownOverlay();
  const states = Object.keys(stateCensusData1953).sort();
  const rows: StateDryRunRow[] = states.map((stateId) => {
    const units = substrate(stateId);
    const isDeepSouth = (DRY_RUN_DEEP_SOUTH as readonly string[]).includes(stateId);
    const brownUnits = isDeepSouth ? substrate(stateId, brown) : null;
    const marginals = stateCensusData1953[stateId] as unknown as Record<
      string,
      Record<string, number>
    >;
    const mass: Record<string, number> = {};
    for (const u of units) {
      for (const [k, wgt] of Object.entries(u.bucketWeights))
        mass[k] = (mass[k] ?? 0) + u.share * wgt;
    }
    let minKeptRatio = Infinity;
    for (const [dim, buckets] of Object.entries(marginals)) {
      if (dim === "ideology" || dim === "positions") continue;
      for (const [bucket, pct] of Object.entries(buckets)) {
        const marginal = (pct as number) / 100;
        if (marginal <= 0) continue;
        minKeptRatio = Math.min(minKeptRatio, (mass[`${dim}:${bucket}`] ?? 0) / marginal);
      }
    }
    return {
      stateId,
      hasOffsets: conditionedOffsetsAtAnchor("1953", stateId).length > 0,
      black: conditioned(units, "race:black"),
      white: conditioned(units, "race:white"),
      blackBrown: brownUnits ? conditioned(brownUnits, "race:black") : null,
      whiteBrown: brownUnits ? conditioned(brownUnits, "race:white") : null,
      minKeptRatio,
    };
  });
  return { rows };
}

const fmt = (v: number): string => v.toFixed(3);
const cell = (m: ConditionedMeans | null, pick: (m: ConditionedMeans) => number): string =>
  m ? fmt(pick(m)) : "n/a";

function renderMarkdown(run: DeepSouthDryRun): string {
  const lines: string[] = [];
  lines.push("# Deep South electorate dry-run (#1165)");
  lines.push("");
  lines.push("Deterministic, DB-free: seed census/position tables plus the authored");
  lines.push("Southern-realignment checkpoint through `buildGranularElectorateSubstrate`.");
  lines.push("Reproduce with:");
  lines.push(
    "`npx tsx scripts/sim/deepSouthElectorateDryRun.ts`, then `npx prettier --write` the capture."
  );

  lines.push("");
  lines.push("## Deep South detail (1953 baseline vs full Brown overlay)");
  lines.push("");
  lines.push(
    "| state | black soc base | black soc Brown | white soc base | white soc Brown | black econ base | black econ Brown | white econ base | white econ Brown |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of run.rows.filter((x) =>
    (DRY_RUN_DEEP_SOUTH as readonly string[]).includes(x.stateId)
  )) {
    lines.push(
      `| ${r.stateId} | ${cell(r.black, (m) => m.soc)} | ${cell(r.blackBrown, (m) => m.soc)} | ${cell(r.white, (m) => m.soc)} | ${cell(r.whiteBrown, (m) => m.soc)} | ${cell(r.black, (m) => m.econ)} | ${cell(r.blackBrown, (m) => m.econ)} | ${cell(r.white, (m) => m.econ)} | ${cell(r.whiteBrown, (m) => m.econ)} |`
    );
  }
  lines.push("");
  lines.push("## All-states 1953 baseline (conditioned means)");
  lines.push("");
  lines.push(
    "| state | offsets | black share | black soc | black econ | white soc | white econ | min kept/marginal |"
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of run.rows) {
    lines.push(
      `| ${r.stateId} | ${r.hasOffsets ? "yes" : "no"} | ${cell(r.black, (m) => m.share)} | ${cell(r.black, (m) => m.soc)} | ${cell(r.black, (m) => m.econ)} | ${cell(r.white, (m) => m.soc)} | ${cell(r.white, (m) => m.econ)} | ${fmt(r.minKeptRatio)} |`
    );
  }
  lines.push("");
  const keptFloor = ELECTORATE_REPRESENTATION_FRACTION;
  lines.push(
    `Guarantee: every present bucket keeps at least ${keptFloor} of its census marginal ` +
      `(min kept/marginal column, floor ${keptFloor}).`
  );
  lines.push("");
  return lines.join("\n");
}

// Script entry: print the markdown report to stdout.
if (require.main === module) {
  process.stdout.write(renderMarkdown(runDeepSouthDryRun()));
}
