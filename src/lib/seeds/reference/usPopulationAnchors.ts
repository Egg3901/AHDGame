import { stateMetrics } from "@/lib/seeds/reference/stateMetrics";
import type { PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";

/**
 * Per-state population pyramid drivers (medianAge + birthRate) for the US, by reset
 * preset. See iePopulationAnchors for the contract. `birthRate` is the 0–100 seed index.
 *
 * 1991 medianAge is each state's 2019 median minus the US national aging delta over the
 * period (~6 years: national median ~33.1 in 1991 → ~38.5 in 2019), grounded in the real
 * per-state 2019 medians (so the per-state ORDER is preserved — Utah youngest, WV/ME/FL
 * oldest). 1991 birthRate is a national index (62, TFR ~2.07 baby-boom echo); per-state
 * 1991 fertility data isn't in the repo, so it isn't varied by state.
 */

/** 2019 = current stateMetrics, derived (parity-safe). */
export const usPopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  stateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 38,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/** 1991 per-state anchors (medianAge ≈ 2019 − 6, clamped ≥ 20; birthRate national 62). */
export const usPopulationAnchors1991: Record<string, PopulationAnchor> = {
  CT: { medianAge: 35, birthRate: 62 },
  DE: { medianAge: 35, birthRate: 62 },
  MA: { medianAge: 33, birthRate: 62 },
  MD: { medianAge: 33, birthRate: 62 },
  ME: { medianAge: 39, birthRate: 62 },
  NH: { medianAge: 36, birthRate: 62 },
  NJ: { medianAge: 35, birthRate: 62 },
  NY: { medianAge: 33, birthRate: 62 },
  PA: { medianAge: 34, birthRate: 62 },
  RI: { medianAge: 35, birthRate: 62 },
  VT: { medianAge: 37, birthRate: 62 },
  AL: { medianAge: 34, birthRate: 62 },
  AR: { medianAge: 32, birthRate: 62 },
  FL: { medianAge: 37, birthRate: 62 },
  GA: { medianAge: 31, birthRate: 62 },
  KY: { medianAge: 34, birthRate: 62 },
  LA: { medianAge: 32, birthRate: 62 },
  MS: { medianAge: 32, birthRate: 62 },
  NC: { medianAge: 33, birthRate: 62 },
  SC: { medianAge: 35, birthRate: 62 },
  TN: { medianAge: 33, birthRate: 62 },
  VA: { medianAge: 32, birthRate: 62 },
  WV: { medianAge: 38, birthRate: 62 },
  IA: { medianAge: 32, birthRate: 62 },
  IL: { medianAge: 32, birthRate: 62 },
  IN: { medianAge: 32, birthRate: 62 },
  KS: { medianAge: 32, birthRate: 62 },
  MI: { medianAge: 34, birthRate: 62 },
  MN: { medianAge: 31, birthRate: 62 },
  MO: { medianAge: 33, birthRate: 62 },
  ND: { medianAge: 30, birthRate: 62 },
  NE: { medianAge: 31, birthRate: 62 },
  OH: { medianAge: 34, birthRate: 62 },
  SD: { medianAge: 30, birthRate: 62 },
  WI: { medianAge: 33, birthRate: 62 },
  AZ: { medianAge: 33, birthRate: 62 },
  NM: { medianAge: 32, birthRate: 62 },
  NV: { medianAge: 33, birthRate: 62 },
  OK: { medianAge: 31, birthRate: 62 },
  TX: { medianAge: 29, birthRate: 62 },
  UT: { medianAge: 25, birthRate: 62 },
  AK: { medianAge: 29, birthRate: 62 },
  CA: { medianAge: 31, birthRate: 62 },
  CO: { medianAge: 31, birthRate: 62 },
  HI: { medianAge: 33, birthRate: 62 },
  ID: { medianAge: 30, birthRate: 62 },
  MT: { medianAge: 35, birthRate: 62 },
  OR: { medianAge: 34, birthRate: 62 },
  WA: { medianAge: 31, birthRate: 62 },
  WY: { medianAge: 32, birthRate: 62 },
  DC: { medianAge: 33, birthRate: 62 },
};
