import { deStateMetrics } from "@/lib/seeds/de/deStateMetrics";
import type { PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";

/**
 * Per-region population pyramid drivers (medianAge + birthRate) for Germany, by reset
 * preset. See iePopulationAnchors for the contract. `birthRate` is the 0–100 seed index.
 */

/** 2019 = current deStateMetrics values, derived (parity-safe; deStateMetrics sets no
 *  birthRate → 2019 index defaults to 50). */
export const dePopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  deStateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 44,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/**
 * 1991 Germany (just after reunification): nationwide younger than 2019 (median ~38),
 * but with a historical INVERSION — the East (BB/MV/SN/ST/TH) was YOUNGER than the West
 * in 1991 (it only aged past the West later, via post-reunification youth emigration).
 * Fertility was in the reunification TROUGH and especially collapsed in the East
 * (TFR ≈ 0.8 there in the early 90s), so 1991 birthRate is LOW — below 2019, unlike IE.
 */
export const dePopulationAnchors1991: Record<string, PopulationAnchor> = {
  // West + Berlin
  BW: { medianAge: 38, birthRate: 40 },
  BY: { medianAge: 38, birthRate: 40 },
  NW: { medianAge: 39, birthRate: 40 },
  HE: { medianAge: 38, birthRate: 40 },
  RP: { medianAge: 39, birthRate: 40 },
  SL: { medianAge: 40, birthRate: 38 },
  NI: { medianAge: 39, birthRate: 40 },
  SH: { medianAge: 39, birthRate: 40 },
  HH: { medianAge: 38, birthRate: 40 }, // Hamburg city-state
  BRE: { medianAge: 40, birthRate: 38 }, // Bremen — older
  BE: { medianAge: 38, birthRate: 38 }, // Berlin
  // East — younger in 1991, fertility collapse
  BB: { medianAge: 36, birthRate: 33 },
  MV: { medianAge: 36, birthRate: 33 },
  SN: { medianAge: 37, birthRate: 33 },
  ST: { medianAge: 37, birthRate: 33 },
  TH: { medianAge: 36, birthRate: 33 },
};
