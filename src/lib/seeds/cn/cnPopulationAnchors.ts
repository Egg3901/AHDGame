import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import type { PopulationAnchor } from "@/lib/seeds/ie/iePopulationAnchors";

/** Per-region population pyramid drivers for China, by reset preset. See
 *  iePopulationAnchors for the contract. `birthRate` is the 0–100 seed index. */

/** 2019 = current cnStateMetrics, derived (parity-safe). */
export const cnPopulationAnchors2019: Record<string, PopulationAnchor> = Object.fromEntries(
  cnStateMetrics.map((m) => [
    String(m._id),
    {
      medianAge: m.population?.medianAge?.value ?? 38,
      birthRate: m.population?.birthRate?.value ?? 50,
    },
  ])
);

/**
 * 1991 China: still young (national median ~25 vs ~38 today) and higher-fertility than
 * today (TFR ~2.0–2.3 — the one-child policy bound urban births from 1979 but rural
 * exemptions kept fertility above 2019's ~1.5). The Northeast (DB) industrial belt was
 * the strictest/lowest-fertility; the rural Southwest/Northwest (XN/XB) the highest.
 */
export const cnPopulationAnchors1991: Record<string, PopulationAnchor> = {
  DB: { medianAge: 26, birthRate: 55 }, // Northeast (Dongbei) — strict urban one-child
  HB: { medianAge: 25, birthRate: 60 }, // North (Huabei)
  HD: { medianAge: 25, birthRate: 58 }, // East (Huadong)
  HZ: { medianAge: 25, birthRate: 62 }, // Central (Huazhong)
  HN: { medianAge: 24, birthRate: 64 }, // South (Huanan)
  XN: { medianAge: 24, birthRate: 66 }, // Southwest (Xinan) — rural, high fertility
  XB: { medianAge: 24, birthRate: 66 }, // Northwest (Xibei) — rural, high fertility
};
