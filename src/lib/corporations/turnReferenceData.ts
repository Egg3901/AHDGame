import type { Db } from "mongodb";
import type {
  CommodityPrice,
  State,
  Tariff,
  Subsidy,
  ExchangeRate,
  StateBudget,
  CentralBank,
} from "@/lib/db/types";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";

export type TurnStateProjection = Pick<
  State,
  "_id" | "name" | "countryId" | "sectorSpecializations" | "gdp"
>;
export type TurnStateBudgetProjection = Pick<StateBudget, "_id" | "taxRates">;

export interface TurnReferenceData {
  commodityPrices: CommodityPrice[];
  allStates: TurnStateProjection[];
  allTariffs: Tariff[];
  /** Active free-trade agreement country pairs (sorted "A|B") that zero out
   * tariffs between partners. See @/lib/tariffs/ftaOverrides. */
  activeFtaPairs: ReadonlySet<string>;
  activeSubsidies: Subsidy[];
  exchangeRateDocs: ExchangeRate[];
  stateBudgetsForTax: TurnStateBudgetProjection[];
  centralBanks: CentralBank[];
}

// Reference data that is invariant within a single game turn. Loading the
// collections inline on every /api/corporations/[id]* request accounted for the
// bulk of the 11.9s p95 we saw in Sentry. Memoize per-turn at module scope:
// Fluid Compute reuses function instances across concurrent requests, so a
// burst of corp-detail requests in the same turn shares a single DB round-trip.
const cache = new Map<number, Promise<TurnReferenceData>>();

export function getTurnReferenceData(db: Db, currentTurn: number): Promise<TurnReferenceData> {
  const existing = cache.get(currentTurn);
  if (existing) return existing;

  // Evict any older turn's promise before inserting the new one. We only ever
  // need the current turn — keeping older entries would hold references to
  // stale commodity/tariff state for no benefit.
  for (const key of cache.keys()) {
    if (key !== currentTurn) cache.delete(key);
  }

  const promise = loadTurnReferenceData(db).catch((err) => {
    // Drop the failed promise so the next request re-attempts the load instead
    // of serving the rejection forever.
    if (cache.get(currentTurn) === promise) cache.delete(currentTurn);
    throw err;
  });
  cache.set(currentTurn, promise);
  return promise;
}

async function loadTurnReferenceData(db: Db): Promise<TurnReferenceData> {
  const [
    commodityPrices,
    allStates,
    allTariffs,
    activeSubsidies,
    exchangeRateDocs,
    stateBudgetsForTax,
    centralBanks,
  ] = await Promise.all([
    db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
    db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, name: 1, countryId: 1, sectorSpecializations: 1, gdp: 1 } })
      .toArray() as Promise<TurnStateProjection[]>,
    db.collection<Tariff>("tariffs").find({}).toArray(),
    db.collection<Subsidy>("subsidies").find({ active: true }).toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find(
        {},
        {
          projection: {
            _id: 1,
            "taxRates.domesticCorporateTax": 1,
            "taxRates.foreignCorporateTax": 1,
          },
        }
      )
      .toArray() as Promise<TurnStateBudgetProjection[]>,
    db.collection<CentralBank>("centralBanks").find({}).toArray(),
  ]);

  const activeFtaPairs = await loadActiveFtaPairs(db);

  return {
    commodityPrices,
    allStates,
    allTariffs,
    activeFtaPairs,
    activeSubsidies,
    exchangeRateDocs,
    stateBudgetsForTax,
    centralBanks,
  };
}

// Test hook: lets vitest reset the module cache between suites without
// re-requiring the module (which doesn't work reliably under vi.mock).
export function __resetTurnReferenceDataCacheForTest(): void {
  cache.clear();
}
