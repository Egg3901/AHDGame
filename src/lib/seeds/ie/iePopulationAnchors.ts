import { ieStateMetrics } from "@/lib/seeds/ie/ieStateMetrics";

/**
 * Per-region population pyramid drivers (medianAge + birthRate) for Ireland, by reset
 * preset. Consumed via `getRegionPopulationAnchor` (src/lib/seeds/populationAnchors.ts)
 * and applied in `applyEra1991Adjustments` so a 1991 reset synthesizes an era-correct
 * (younger, higher-fertility) age pyramid. `birthRate` is the 0–100 seed index
 * (50 ≈ replacement), NOT a raw rate.
 */
export interface PopulationAnchor {
  medianAge: number; // years
  birthRate: number; // 0–100 index (higher = more births)
}

/**
 * 2019 anchors = the current `ieStateMetrics` values, DERIVED (not hand-copied) so they
 * stay in lockstep with the seed and the parity test can't drift. Used only as the
 * parity reference + selector fallback (the 2019 reset path reads stateMetrics directly).
 */
export const iePopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  ieStateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 38,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/**
 * 1991 Ireland: Western Europe's youngest, highest-fertility society (national median
 * age ~31, TFR ~2.1 falling from the 1970s peak; Dublin youngest, the rural west/border
 * a touch older). Hand-authored per region; all are younger + higher-fertility than 2019.
 */
export const iePopulationAnchors1991: Record<string, PopulationAnchor> = {
  DUB: { medianAge: 29, birthRate: 70 }, // Dublin — youngest, urban
  KIL: { medianAge: 31, birthRate: 70 }, // Kildare/Leinster commuter belt
  MID: { medianAge: 31, birthRate: 70 }, // Midlands
  WEX: { medianAge: 31, birthRate: 72 }, // Wexford/South-East — rural, high fertility
  LIM: { medianAge: 30, birthRate: 70 }, // Limerick/Mid-West
  COR: { medianAge: 30, birthRate: 68 }, // Cork — second city
  GAL: { medianAge: 30, birthRate: 72 }, // Galway/West — rural, high fertility
  DON: { medianAge: 32, birthRate: 72 }, // Donegal/Border — older skew + high fertility
};
