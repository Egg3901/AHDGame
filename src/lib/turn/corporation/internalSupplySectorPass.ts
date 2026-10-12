/**
 * Finalize internal input discounts after actual plant consumption is known,
 * before corporation income, taxes and dividends. Each sector runs once.
 */
import { processSector, type SectorTurnEnv, type SectorTurnResult } from "./sectorTurn";
import {
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { settleConsumedInternalDiscounts } from "@/lib/market/internalSupply/rules";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

export function prepareInternalSupplySectorResults(
  env: SectorTurnEnv
): Map<string, SectorTurnResult> | undefined {
  if (!env.market.internalSupplyTrades?.length) return undefined;
  const results = new Map<string, SectorTurnResult>();
  // The pre-pass is DB-free. Cache results, including their update collectors;
  // the normal corporation loop consumes them instead of running sectors again.
  env.market.internalSupplyDiscountCostBySectorId = undefined;
  for (const corp of env.lookups.corporations) {
    const sectors = env.lookups.sectorsByCorp.get(corp._id.toString()) ?? [];
    for (const sector of sectors)
      results.set(
        sector._id.toString(),
        processSector(
          env,
          corp,
          sector,
          sectors.length,
          resolveSectorHostCurrencyCode(sector, corp),
          fxRateForSectorHostFromMap(sector, corp, env.lookups.exchangeRatesByCurrency)
        )
      );
  }
  const consumption = new Map(
    [...results].map(([id, r]) => [id, r.internalSupplyInputUnits ?? new Map<string, number>()])
  );
  const costs = settleConsumedInternalDiscounts(
    env.market.internalSupplyTrades,
    consumption,
    TURNS_PER_DAY,
    env.market.internalSupplyCommittedInputsBySectorId
  );
  env.market.internalSupplyDiscountCostBySectorId = costs;
  for (const [id, cost] of costs)
    if (cost !== 0) results.get(id)?.applyInternalSupplyDiscount?.(cost);
  return results;
}
