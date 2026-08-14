import type { CommodityType } from "@/lib/constants/commodities";

/**
 * Throughput coupling — Tier 3 phase D1 of the structural market rework
 * (audit t806, Fix 3; see docs/plans/2026-07-03-market-structural-plan.md).
 *
 * A sector's realized output is limited by the availability of its scarcest
 * input (Leontief-style): if the market only supplies 60% of the steel car
 * plants demand, car plants realize at most ~60% of their output — exactly as
 * an iron miner is throttled by geological capacity today. Generalizes the
 * extraction capacity haircut to every sector; the same 240-turn ramp
 * machinery (`capacityHaircutFactor`) fades it in per sector.
 *
 * Guards:
 *  - `THROUGHPUT_MIN` floors the factor so an input shortage can throttle but
 *    never zero a sector — and, with the one-turn-lagged balances, prevents
 *    the death-spiral where less output deepens the shortage that caused it.
 *  - Inputs with no market data are treated as fully available.
 */
export const THROUGHPUT_MIN = 0.5;

type Balance = { supply: number; demand: number };

/**
 * Availability of one input commodity: what fraction of demand the market can
 * actually satisfy, `min(1, supply/demand)`. Missing/degenerate data → 1.
 */
export function inputAvailability(balance: Balance | undefined): number {
  if (!balance) return 1;
  const { supply, demand } = balance;
  if (!(demand > 0) || !Number.isFinite(supply / demand)) return 1;
  return Math.min(1, Math.max(0, supply / demand));
}

/**
 * Leontief throughput for one sector: the scarcest input binds.
 * Returns the clamped factor plus which input binds (null when unconstrained).
 */
export function computeThroughput(
  demandRates: Partial<Record<CommodityType, number>>,
  balances: ReadonlyMap<CommodityType, Balance>,
  /** Optional local delivery result. Missing commodities retain global availability. */
  localAvailability?: ReadonlyMap<CommodityType, number>
): { throughput: number; bindingInput: CommodityType | null } {
  if (!demandRates) return { throughput: 1, bindingInput: null };
  let min = 1;
  let bindingInput: CommodityType | null = null;
  for (const commodity of Object.keys(demandRates) as CommodityType[]) {
    const rate = demandRates[commodity] ?? 0;
    if (rate <= 0) continue;
    const delivered = localAvailability?.get(commodity);
    const avail =
      typeof delivered === "number" && Number.isFinite(delivered)
        ? Math.min(1, Math.max(0, delivered))
        : inputAvailability(balances.get(commodity));
    if (avail < min) {
      min = avail;
      bindingInput = commodity;
    }
  }
  const throughput = Math.max(THROUGHPUT_MIN, min);
  return { throughput, bindingInput: min < 1 ? bindingInput : null };
}
