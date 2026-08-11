import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";
import type { PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";

/**
 * Per-region population pyramid drivers (medianAge + birthRate) for Japan, by reset
 * preset. See iePopulationAnchors for the contract. `birthRate` is the 0–100 seed index.
 */

/** 2019 = current jpStateMetrics values, derived (parity-safe). */
export const jpPopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  jpStateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 48,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/**
 * 1991 Japan: national median age ~37.7 (vs ~48 today — Japan aged faster than any
 * country), Tokyo/Kanto the youngest, the rural Tohoku/Shikoku belts the oldest.
 * Fertility was past the 1989 "1.57 shock" (TFR ~1.53) — higher than 2019's ~1.36, so
 * 1991 birthRate sits modestly above today's (we keep the index in-range rather than
 * asserting a per-region direction, since urban Kanto was already low).
 */
export const jpPopulationAnchors1991: Record<string, PopulationAnchor> = {
  HOK: { medianAge: 38, birthRate: 44 }, // Hokkaido
  TOH: { medianAge: 39, birthRate: 44 }, // Tohoku — rural, oldest skew
  KAN: { medianAge: 36, birthRate: 40 }, // Kanto/Tokyo — youngest, urban-low fertility
  CHU: { medianAge: 37, birthRate: 44 }, // Chubu
  KNS: { medianAge: 37, birthRate: 42 }, // Kansai
  CGK: { medianAge: 38, birthRate: 44 }, // Chugoku
  SHI: { medianAge: 39, birthRate: 44 }, // Shikoku — rural, oldest skew
  KYU: { medianAge: 37, birthRate: 44 }, // Kyushu
};
