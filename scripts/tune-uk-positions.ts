/**
 * Temporary UK positions tuner (coordinate descent). Run:
 *   npx tsx scripts/tune-uk-positions.ts <era>
 * Prints optimized POSITIONS table for that era.
 */
import { readFileSync } from "fs";
import { getUkModel } from "../src/lib/seeds/international/uk";
import {
  editorConfigFromCountryModel,
  computeDerivedCompositionGeneric,
} from "../src/lib/positionEditor/derive";
import { getTarget } from "../src/lib/seeds/calibration/targets";
import {
  deriveCountryGroupPopulations,
  deriveCountryGroupLean,
  deriveCountryGroupTurnout,
} from "../src/lib/seeds/international/derive";
import { ukDemographicCategories } from "../src/lib/seeds/uk/ukDemographicCategories";
import { calculateStateLean, getDisplayLean } from "../src/lib/utils/demographics";
import type { StateDemographics } from "../src/lib/db/types";
import type { EraId } from "../src/lib/seeds/presetSelector";

const era = (process.argv[2] ?? "1979") as EraId;
const target = getTarget("UK", era)!;

// Extra sign constraints for 2019 from scripts/calibrate-uk-layer1.ts
const EXTRA_2019: { left: string[]; right: string[] } = {
  left: ["LON", "SCO", "WAL"],
  right: ["SEE", "SWE", "EAE", "EMI", "WMI", "YHU", "NWE", "NEE", "NIR"],
};

const model = getUkModel(era);
type Pos = { economicLean: number; socialLean: number };
type Positions = Record<string, Record<string, Pos>>;

function clonePositions(p: Positions): Positions {
  return JSON.parse(JSON.stringify(p));
}
const orig: Positions = clonePositions(model.positions as Positions);
let init: Positions = clonePositions(orig);
// Optional init file (JSON positions), e.g. seed 2007 from the 1999 solution.
const initFile = process.argv.find((a) => a.endsWith(".json"));
if (initFile) {
  init = JSON.parse(readFileSync(initFile, "utf8"));
}

function derive(pos: Positions): Record<string, { e: number; s: number; d: number }> {
  const m = { ...model, positions: pos };
  const out: Record<string, { e: number; s: number; d: number }> = {};
  for (const regionId of Object.keys(m.census)) {
    const ed = editorConfigFromCountryModel(m, regionId, era, {});
    const d = computeDerivedCompositionGeneric(ed);
    out[regionId] = { e: d.stateEconomicLean, s: d.stateSocialLean, d: d.stateDisplayLean };
  }
  return out;
}

// Seed-path derivation (2dp rounding; same path as uk.test.ts + calibrate-uk-layer1.ts)
function deriveSeedPath(pos: Positions): Record<string, { e: number; s: number; d: number }> {
  const m = { ...model, positions: pos };
  const out: Record<string, { e: number; s: number; d: number }> = {};
  for (const regionId of Object.keys(m.census)) {
    const config = m.census[regionId];
    const pops = deriveCountryGroupPopulations(m, config);
    const groups: StateDemographics["groups"] = {};
    for (const gid of m.groupIds) {
      const lean = deriveCountryGroupLean(m, gid, config);
      groups[gid] = {
        population: pops[gid] ?? 0,
        economicLean: lean.economicLean,
        socialLean: lean.socialLean,
        turnout: deriveCountryGroupTurnout(m, gid),
      };
    }
    const demographics: StateDemographics = {
      _id: regionId,
      countryId: "UK",
      categoryWeights: { uk_voterGroups: 100 },
      groups,
      lastUpdated: new Date(),
    } as StateDemographics;
    const { economicLean, socialLean } = calculateStateLean(demographics, ukDemographicCategories);
    out[regionId] = { e: economicLean, s: socialLean, d: getDisplayLean(economicLean, socialLean) };
  }
  return out;
}

const MARGIN = 0.18;
const SPREAD_ONLY = process.argv[3] === "spread";
function lossOnRows(rows: Record<string, { e: number; s: number; d: number }>): number {
  const ds = Object.values(rows).map((r) => r.d);
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const spread = Math.max(...ds) - Math.min(...ds);
  let L = 0;
  const centerErr = Math.abs(mean - target.center);
  if (centerErr > target.centerTol - 0.1) L += (centerErr - (target.centerTol - 0.1)) * 3;
  if (spread < target.minSpread + 0.15) L += (target.minSpread + 0.15 - spread) * 2;
  const left = [...target.expectLeft];
  const right = [...target.expectRight];
  if (era === "2019") {
    for (const r of EXTRA_2019.left) if (!left.includes(r)) left.push(r);
    for (const r of EXTRA_2019.right) if (!right.includes(r)) right.push(r);
  }
  for (const id of left) {
    const m = era === "2019" && id === "WAL" ? 0.08 : MARGIN;
    const v = rows[id]?.d ?? 0;
    if (v > -m) L += (v + m) * (id === "WAL" ? 6 : 2);
  }
  for (const id of right) {
    const m =
      era === "2019" && ["NEE", "NIR", "NWE", "YHU", "WMI", "EMI"].includes(id) ? 0.08 : MARGIN;
    const v = rows[id]?.d ?? 0;
    if (v < m) L += (m - v) * 2;
  }
  // Dominance-gap: when econ/social have opposite signs, the display comes from
  // the dominant axis — require a clear gap so 1dp vs 2dp rounding can't flip it.
  for (const r of Object.values(rows)) {
    if (r.e >= 0 !== r.s >= 0) {
      const gap = Math.abs(Math.abs(r.e) - Math.abs(r.s));
      if (gap < 0.15) L += (0.15 - gap) * 1.5;
    }
  }
  return L;
}

function loss(pos: Positions): number {
  const rows = derive(pos);
  if (SPREAD_ONLY) {
    const ds = Object.values(rows).map((r) => r.d);
    return -(Math.max(...ds) - Math.min(...ds));
  }
  let L = lossOnRows(rows) + lossOnRows(deriveSeedPath(pos));
  // Regularizers: stay near initial (historical plausibility), keep e/s separated a bit
  for (const dim of Object.keys(pos)) {
    for (const key of Object.keys(pos[dim])) {
      const p = pos[dim][key];
      const i = orig[dim][key];
      const de = Math.abs(p.economicLean - i.economicLean);
      const ds2 = Math.abs(p.socialLean - i.socialLean);
      L += 0.02 * (de + ds2);
      if (de > 4) L += (de - 4) * 2;
      if (ds2 > 4) L += (ds2 - 4) * 2;
      if (Math.abs(p.economicLean - p.socialLean) < 0.2) L += 0.02;
    }
  }
  return L;
}

function descend(start: Positions): { pos: Positions; l: number } {
  const c = clonePositions(start);
  let b = loss(c);
  const steps = [2.0, 1.5, 1.0, 0.5, 0.3, 0.2, 0.1];
  for (let sweep = 0; sweep < 20; sweep++) {
    let improved = false;
    for (const dim of Object.keys(c)) {
      for (const key of Object.keys(c[dim])) {
        for (const axis of ["economicLean", "socialLean"] as const) {
          for (const st of steps) {
            for (const dir of [1, -1]) {
              const old = c[dim][key][axis];
              const nv = Math.max(-5, Math.min(5, Math.round((old + dir * st) * 10) / 10));
              if (nv === old) continue;
              c[dim][key][axis] = nv;
              const l = loss(c);
              if (l < b - 1e-9) {
                b = l;
                improved = true;
              } else {
                c[dim][key][axis] = old;
              }
            }
          }
        }
      }
    }
    if (!improved) break;
  }
  return { pos: c, l: b };
}

let seed = 12345;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

if (process.argv.includes("eval")) {
  const rowsE = derive(init);
  console.error(`loss ${loss(init).toFixed(4)}`);
  for (const [id, r] of Object.entries(rowsE).sort((a, b) => a[1].d - b[1].d))
    console.error(`${id} e=${r.e} s=${r.s} d=${r.d}`);
  process.exit(0);
}

let { pos: cur, l: best } = descend(init);
console.error(`restart 0 loss ${best.toFixed(4)}`);
for (let r = 1; r < 24 && best > 0.4; r++) {
  const jittered = clonePositions(r % 2 === 0 ? cur : init);
  for (const dim of Object.keys(jittered))
    for (const key of Object.keys(jittered[dim]))
      for (const axis of ["economicLean", "socialLean"] as const)
        jittered[dim][key][axis] = Math.max(
          -5,
          Math.min(5, Math.round((jittered[dim][key][axis] + (rand() - 0.5) * 4) * 10) / 10)
        );
  const res = descend(jittered);
  console.error(`restart ${r} loss ${res.l.toFixed(4)}`);
  if (res.l < best) {
    best = res.l;
    cur = res.pos;
  }
}

const rows = derive(cur);
const ds = Object.values(rows).map((r) => r.d);
console.error(
  `mean ${(ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(3)} spread ${(Math.max(...ds) - Math.min(...ds)).toFixed(3)}`
);
for (const [id, r] of Object.entries(rows).sort((a, b) => a[1].d - b[1].d))
  console.error(`${id} e=${r.e} s=${r.s} d=${r.d}`);

console.log(JSON.stringify(cur, null, 2));
