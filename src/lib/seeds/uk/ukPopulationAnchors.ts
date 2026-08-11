import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";
import type { PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";

/** Per-region population pyramid drivers for the UK, by reset preset. See
 *  iePopulationAnchors for the contract. `birthRate` is the 0–100 seed index. */

/** 2019 = current ukStateMetrics, derived (parity-safe). */
export const ukPopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  ukStateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 40,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/**
 * 1991 UK: modestly younger than today (national median ~36 vs ~40). London was already
 * the youngest region; the South-West / North-East the oldest; Northern Ireland markedly
 * younger with the UK's highest fertility. Fertility (TFR ~1.8) was only slightly above
 * 2019's ~1.7, so we don't assert a per-region higher-fertility direction.
 */
export const ukPopulationAnchors1991: Record<string, PopulationAnchor> = {
  LON: { medianAge: 33, birthRate: 54 }, // London — youngest
  SEE: { medianAge: 36, birthRate: 50 }, // South East
  SWE: { medianAge: 38, birthRate: 48 }, // South West — oldest
  EAE: { medianAge: 37, birthRate: 50 }, // East of England
  EMI: { medianAge: 36, birthRate: 52 }, // East Midlands
  WMI: { medianAge: 35, birthRate: 54 }, // West Midlands
  YHU: { medianAge: 36, birthRate: 54 }, // Yorkshire & Humber
  NWE: { medianAge: 36, birthRate: 54 }, // North West
  NEE: { medianAge: 37, birthRate: 52 }, // North East
  SCO: { medianAge: 36, birthRate: 50 }, // Scotland
  WAL: { medianAge: 37, birthRate: 52 }, // Wales
  NIR: { medianAge: 31, birthRate: 60 }, // Northern Ireland — youngest, highest fertility
};
