/**
 * Solve per-state deltas for the four authored position-override buckets
 * (race.white, education.no_college, wealth.middle, age.senior) in
 * stateCensusData so each state's turnout-weighted mean lean hits a target
 * derived from the real 2020 two-party margin (target = -margin/30, capped).
 * Mutates stateCensusData in memory, iterates to convergence, prints the final
 * bucket values per state as JSON for the codemod to apply.
 * Run: npx tsx scripts/calibrate-2019-state-positions.ts
 */
import { stateCensusData } from "../src/lib/seeds/stateCensusData";
import {
  deriveGranularElectorateUnits,
  clearGranularElectorateCache,
} from "../src/lib/demographics/granularElectorate";

// 2020 two-party margin, Dem minus Rep, percentage points.
const MARGIN_2020: Record<string, number> = {
  AL: -25.5,
  AK: -10.1,
  AZ: 0.3,
  AR: -27.6,
  CA: 29.2,
  CO: 13.5,
  CT: 20.1,
  DE: 19.0,
  DC: 86.8,
  FL: -3.4,
  GA: 0.2,
  HI: 29.5,
  ID: -30.8,
  IL: 17.0,
  IN: -16.1,
  IA: -8.2,
  KS: -14.6,
  KY: -26.0,
  LA: -18.6,
  ME: 9.1,
  MD: 33.2,
  MA: 33.5,
  MI: 2.8,
  MN: 7.1,
  MS: -16.5,
  MO: -15.4,
  MT: -16.4,
  NE: -19.1,
  NV: 2.4,
  NH: 7.4,
  NJ: 15.9,
  NM: 10.8,
  NY: 23.1,
  NC: -1.3,
  ND: -33.4,
  OH: -8.0,
  OK: -33.1,
  OR: 16.1,
  PA: 1.2,
  RI: 20.8,
  SC: -11.7,
  SD: -26.2,
  TN: -23.2,
  TX: -5.6,
  UT: -20.5,
  VT: 35.4,
  VA: 10.1,
  WA: 19.2,
  WV: -38.9,
  WI: 0.6,
  WY: -43.4,
};

const clampV = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function measure(stateId: string): { econ: number; social: number } {
  clearGranularElectorateCache();
  const derived = deriveGranularElectorateUnits("US", stateId, "2019-default", null);
  if (!derived) return { econ: NaN, social: NaN };
  let ne = 0;
  let ns = 0;
  let den = 0;
  for (const u of derived.units) {
    const w = u.share * u.turnout;
    ne += w * u.economicLean;
    ns += w * u.socialLean;
    den += w;
  }
  return { econ: ne / den, social: ns / den };
}

const BUCKETS: Array<[string, string]> = [
  ["race", "white"],
  ["education", "no_college"],
  ["wealth", "middle"],
  ["age", "senior"],
];

const out: Record<string, Record<string, { economicLean: number; socialLean: number }>> = {};

for (const stateId of Object.keys(MARGIN_2020)) {
  const config = stateCensusData[stateId] as any;
  if (!config?.positions) {
    console.error(`SKIP ${stateId}: no positions`);
    continue;
  }
  const target = clampV(-MARGIN_2020[stateId] / 30, -2.6, 1.6);

  // Effective sensitivity of a uniform delta on the four buckets: sum of the
  // buckets' census shares / 4 dims (turnout weighting shifts this a little,
  // so we iterate).
  const sens =
    (config.race.white + config.education.no_college + config.wealth.middle + config.age.senior) /
    100 /
    4;

  for (let iter = 0; iter < 12; iter++) {
    const cur = measure(stateId).econ;
    const err = target - cur;
    if (Math.abs(err) < 0.02) break;
    const delta = err / sens;
    for (const [dim, key] of BUCKETS) {
      const p = config.positions[dim]?.[key];
      if (!p) continue;
      p.economicLean = clampV(p.economicLean + delta, -5, 5);
      p.socialLean = clampV(p.socialLean + delta, -5, 5);
    }
  }

  const final = measure(stateId);
  const vals: Record<string, { economicLean: number; socialLean: number }> = {};
  for (const [dim, key] of BUCKETS) {
    const p = config.positions[dim]?.[key];
    if (!p) continue;
    vals[`${dim}.${key}`] = {
      economicLean: Math.round(p.economicLean * 10) / 10,
      socialLean: Math.round(p.socialLean * 10) / 10,
    };
  }
  out[stateId] = vals;
  console.error(
    `${stateId}: target ${target.toFixed(2)}  got ${final.econ.toFixed(2)}/${final.social.toFixed(
      2
    )}  white=${vals["race.white"]?.economicLean}`
  );
}

console.log(JSON.stringify(out, null, 2));
