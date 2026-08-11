import { describe, it, expect } from "vitest";
import {
  deriveGranularElectorateUnits,
  clearGranularElectorateCache,
} from "@/lib/demographics/granularElectorate";

/**
 * THE era-ladder balance lock (2026-08).
 *
 * Every era's per-state seed is solved against its real anchor election with
 * the compressed mapping (mean = -(0.5*margin + c)/30, c pulling 2.5pts
 * toward even for landslide anchors). This file pins the LEVEL of the whole
 * ladder on the GRANULAR VOTE PATH — the substrate general elections actually
 * consume — so any future "recalibration" that silently tilts an era left or
 * right fails loudly here instead of surfacing as a lopsided world months
 * later. The bands are ±0.12 (US) / ±0.3 (UK) around the solved 2026-08
 * values; a deliberate retune should move the bands in the same commit, with
 * the reasoning, not delete them.
 *
 * Context for the bands: US eras all sit within ±0.1 of centre with tilt
 * signs matching their anchors (Ike/Reagan/Bush R, 2000 tie, Obama D, 2020
 * near-tie). UK econ means are level-anchored per era (Thatcher/Major right
 * of Blair; 1999 is deliberately the leftmost UK era; 2019 near zero) — the
 * UK balance is realized through both axes, so the econ level is the guarded
 * proxy. See the lean-lab audit doc (ops-knowledge: ahd-1953-seed-balance-
 * retune and the era-sweep addendum) for the full realized-share picture.
 */

const US_STATES_51 = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];
const UK_GB_REGIONS = ["LON", "SEE", "SWE", "EAE", "EMI", "WMI", "YHU", "NWE", "NEE", "SCO", "WAL"];

function ladderMean(country: string, states: string[], era: string): number {
  let num = 0;
  let den = 0;
  for (const s of states) {
    clearGranularElectorateCache();
    const d = deriveGranularElectorateUnits(country, s, `${era}-default`, null);
    expect(d, `${country}/${s}/${era} should derive cells`).not.toBeNull();
    for (const u of d!.units) {
      const w = u.share * u.turnout;
      num += w * u.economicLean;
      den += w;
    }
  }
  return num / den;
}

// Solved 2026-08 levels (turnout-weighted mean econ lean across all states).
const US_LEVELS: Record<string, number> = {
  "1953": 0.1,
  "1979": 0.09,
  "1991": 0.03,
  "1999": 0.05,
  "2007": -0.06,
  "2019": 0.03,
};
const UK_LEVELS: Record<string, number> = {
  "1953": -1.23,
  "1979": -0.97,
  "1991": -1.43,
  "1999": -2.15,
  "2007": -1.28,
  "2019": -0.15,
};

describe("era balance ladder — granular vote-path levels", () => {
  for (const [era, level] of Object.entries(US_LEVELS)) {
    it(`US ${era} electorate level holds (${level} ± 0.12)`, () => {
      const mean = ladderMean("US", US_STATES_51, era);
      expect(mean).toBeGreaterThan(level - 0.12);
      expect(mean).toBeLessThan(level + 0.12);
    });
  }
  for (const [era, level] of Object.entries(UK_LEVELS)) {
    it(`UK ${era} electorate level holds (${level} ± 0.3)`, () => {
      const mean = ladderMean("UK", UK_GB_REGIONS, era);
      expect(mean).toBeGreaterThan(level - 0.3);
      expect(mean).toBeLessThan(level + 0.3);
    });
  }

  it("US tilt ordering matches the anchor elections", () => {
    // Obama-era is the leftmost US era; the Ike era the rightmost.
    const by: Record<string, number> = {};
    for (const era of Object.keys(US_LEVELS)) by[era] = ladderMean("US", US_STATES_51, era);
    expect(by["2007"]).toBeLessThan(by["1999"]);
    expect(by["2007"]).toBeLessThan(by["1953"]);
    expect(by["1953"]).toBeGreaterThan(by["1991"]);
  });

  it("UK 1999 is the leftmost UK era (Blair landslide)", () => {
    const by: Record<string, number> = {};
    for (const era of Object.keys(UK_LEVELS)) by[era] = ladderMean("UK", UK_GB_REGIONS, era);
    for (const era of ["1953", "1979", "1991", "2007", "2019"]) {
      expect(by["1999"], era).toBeLessThan(by[era]);
    }
  });
});
