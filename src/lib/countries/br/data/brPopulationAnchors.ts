import { brStateMetrics } from "@/lib/seeds/br/brStateMetrics";
import type { PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";

/** Per-region population pyramid drivers for Brazil, by reset preset. See
 *  iePopulationAnchors for the contract. `birthRate` is the 0–100 seed index. */

/** 2019 = current brStateMetrics, derived (parity-safe). */
export const brPopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  brStateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 33,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/**
 * 1991 Brazil: a very young, high-fertility society (national median ~22, TFR ~2.9 vs
 * ~1.7 today). The North/Northeast were youngest and highest-fertility; the
 * Southeast/South already more advanced in the demographic transition.
 */
export const brPopulationAnchors1991: Record<string, PopulationAnchor> = {
  NORTE: { medianAge: 19, birthRate: 82 }, // Amazonian North — youngest
  NORDESTE: { medianAge: 20, birthRate: 80 }, // Northeast
  CENTRO_OESTE: { medianAge: 21, birthRate: 74 }, // Center-West
  SUDESTE: { medianAge: 23, birthRate: 68 }, // Southeast (São Paulo/Rio) — most advanced
  SUL: { medianAge: 23, birthRate: 66 }, // South — most advanced
};
