import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import type { PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";

/** Per-zone population pyramid drivers for Nigeria, by reset preset. See
 *  iePopulationAnchors for the contract. `birthRate` is the 0–100 seed index. */

/** 2019 = current ngStateMetrics, derived (parity-safe). */
export const ngPopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  ngStateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 18,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/**
 * 1991 Nigeria: an even younger, higher-fertility society (national median ~15, TFR ~6.5
 * vs ~5.0 today). The North was youngest and highest-fertility; the South was already
 * further along the demographic transition. Hand-authored per zone; all are younger and
 * higher-fertility than 2019. NOTE: the 2019 anchor is derived from `ngStateMetrics`; the
 * 1991 anchor is used only when a 1991 reset path reads population anchors directly.
 */
export const ngPopulationAnchors1991: Record<string, PopulationAnchor> = {
  NORTH_WEST: { medianAge: 15, birthRate: 92 }, // Hausa-Fulani core — youngest, highest fertility
  NORTH_EAST: { medianAge: 15, birthRate: 92 }, // Borno / Yobe — youngest
  NORTH_CENTRAL: { medianAge: 16, birthRate: 88 }, // Middle belt
  SOUTH_WEST: { medianAge: 17, birthRate: 82 }, // Lagos / Yoruba — most advanced
  SOUTH_SOUTH: { medianAge: 17, birthRate: 84 }, // Niger Delta
  SOUTH_EAST: { medianAge: 17, birthRate: 82 }, // Igbo — most advanced in the South
};
