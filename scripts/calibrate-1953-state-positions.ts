/**
 * Solve per-state `race.white` position values for the 1953 era so each
 * state's turnout-weighted mean lean matches a COMPRESSED 1952 two-party
 * presidential margin: target = -(0.5*margin + 2.5)/30 (same -margin/30
 * mapping the 2019 calibration uses, at half scale plus a small Democratic
 * offset). 2026-08 balance decision for the long 1953 iteration: the full
 * 1952 margins reproduce the Eisenhower landslide (43 of 51 states R-lean,
 * static-kernel national two-way ~R+14), which is historically right but
 * gameplay-hostile for Left players in the flagship era. Half-scale margins
 * keep the SHAPE (Solid South D, Plains/N.New England R, mild national Ike
 * tilt) while opening a wide competitive belt. The Deep South six (AL MS SC
 * GA LA AR) are solved with a FLOOR of -0.5 econ mean: their '52 presidential
 * vote came from a suppressed electorate and their registration identity is
 * Democratic regardless of the Ike wave.
 *
 * The 1953 era has no per-state census `positions` blocks by design; its
 * per-state surface is STATE_POSITION_OVERRIDES["1953"] in
 * demographicCategories.ts. This script solves the values by injecting trial
 * positions into the in-memory census configs (bisection on the white econ
 * position; social tracks econ at 0.6 of the delta) and prints the final
 * white econ/social per state for manual transfer into that table.
 *
 * Run: npx tsx scripts/calibrate-1953-state-positions.ts
 */
import { getRegionCensusData } from "../src/lib/seeds/regionCensusData";
import { getEraPositions } from "../src/lib/seeds/demographicCategories";
import {
  deriveGranularElectorateUnits,
  clearGranularElectorateCache,
} from "../src/lib/demographics/granularElectorate";

// 1952 two-party margin, Dem minus Rep, percentage points (Eisenhower v Stevenson).
const MARGIN_1952: Record<string, number> = {
  AL: 29.9,
  MS: 20.8,
  SC: 1.5,
  GA: 39.4,
  LA: 5.8,
  AR: 12.1,
  NC: 7.8,
  KY: 0.1,
  WV: 3.8,
  TN: -0.3,
  TX: -6.6,
  FL: -10.0,
  VA: -12.9,
  OK: -9.2,
  MO: -1.7,
  MD: -11.5,
  DE: -3.9,
  NJ: -14.8,
  NY: -11.9,
  CT: -11.6,
  RI: -1.9,
  MA: -8.8,
  VT: -43.3,
  NH: -21.8,
  ME: -32.3,
  PA: -5.9,
  OH: -13.5,
  IN: -17.1,
  IL: -9.9,
  MI: -11.5,
  WI: -22.2,
  MN: -11.2,
  IA: -28.2,
  KS: -38.3,
  NE: -38.2,
  SD: -38.6,
  ND: -42.5,
  MT: -19.3,
  WY: -25.6,
  CO: -21.3,
  NM: -11.3,
  AZ: -16.6,
  UT: -17.9,
  ID: -31.0,
  NV: -22.9,
  WA: -9.6,
  OR: -21.6,
  CA: -13.6,
};

const clampV = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function measure(stateId: string): { econ: number; social: number } | null {
  clearGranularElectorateCache();
  const derived = deriveGranularElectorateUnits("US", stateId, "1953-default", null);
  if (!derived) return null;
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

for (const stateId of Object.keys(MARGIN_1952)) {
  const config = getRegionCensusData("US", stateId, "1953-default") as {
    race?: Record<string, number>;
    positions?: Record<string, Record<string, { economicLean: number; socialLean: number }>>;
  } | null;
  if (!config?.race) {
    console.error(`SKIP ${stateId}: no 1953 census`);
    continue;
  }
  // Deep South floors: -0.5 keeps registration identity; AL is deeper because
  // granularElectorateYear.test.ts pins its 1953->1979 realignment DIRECTION
  // against the Carter-solved 1979 anchor (unweighted mean -0.63) — the 1953
  // mean must sit clearly left of that or the era clock runs AL backwards.
  const DEEP_SOUTH_FLOOR: Record<string, number> = {
    AL: -0.75,
    MS: -0.5,
    SC: -0.5,
    GA: -0.5,
    LA: -0.5,
    AR: -0.5,
  };
  let target = clampV(-(0.5 * MARGIN_1952[stateId] + 2.5) / 30, -2.6, 1.6);
  const floor = DEEP_SOUTH_FLOOR[stateId];
  if (floor !== undefined) target = Math.min(target, floor);

  // Authored merged white position (era base + STATE_POSITION_OVERRIDES).
  const authored = getEraPositions("1953", stateId).race.white;
  // Social tracks econ at the authored 1953 ratio (~0.6 of the econ delta).
  const startE = authored.economicLean;
  const startS = authored.socialLean;

  const setWhite = (v: number) => {
    config.positions = {
      race: {
        white: {
          economicLean: clampV(v, -4.5, 4.5),
          socialLean: clampV(startS + 0.6 * (v - startE), -4.5, 4.5),
        },
      },
    };
  };
  // Bisection: state mean econ is monotone-increasing in the white position.
  let lo = -4.5;
  let hi = 4.5;
  let e = 0;
  for (let iter = 0; iter < 26; iter++) {
    e = (lo + hi) / 2;
    setWhite(e);
    const cur = measure(stateId);
    if (!cur) break;
    if (cur.econ < target) lo = e;
    else hi = e;
    if (Math.abs(cur.econ - target) < 0.01) break;
  }
  setWhite(e);
  const final = measure(stateId);
  const w = config.positions!.race.white;
  // Leave the injected positions in place so later states' national context
  // (none — derivation is per-state) is unaffected; printed for transfer.
  console.log(
    `${stateId}\ttarget ${target.toFixed(2)}\tgot ${final?.econ.toFixed(2)}/${final?.social.toFixed(
      2
    )}\twhite ${Math.round(w.economicLean * 10) / 10}, ${Math.round(w.socialLean * 10) / 10}\t(was ${startE}, ${startS})`
  );
}
