/**
 * NPC corporation decisions share ownership and plant-pricing snapshots.
 * Ownership uses the cohort sector snapshot; plant quotes share bank rates,
 * living costs, era scale and national shares through the context loaders.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector, ExchangeRate, GameState } from "@/lib/db/types";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  computeStateControlledBuckets,
  loadNationalCorpIds,
} from "@/lib/nationalization/stateControlledBuckets";
import { buildCapacityCompetitorIndex } from "@/lib/turn/npp/capacityDecisionTelemetry";
import { buildNppNationalShareResolver } from "@/lib/turn/npp/nationalDominancePricing";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import type { RelocationPrimeBank } from "@/lib/corporations/issueRelocationBond";
import { loadNppBankRateSnapshot } from "@/lib/turn/npp/bankRateSnapshot";
import { loadNppCostOfLivingByState } from "@/lib/turn/npp/manufacturingProducts";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import type { NppPlantsContext } from "@/lib/turn/npp/corpDecisionTypes";

export async function loadNppMarketDecisionContext(db: Db) {
  // NPPs cannot auto-expand into state-controlled buckets; players still may.
  const [nationalCorpIds, globalSectors] = await Promise.all([
    loadNationalCorpIds(db),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        {},
        {
          projection: {
            stateId: 1,
            countryId: 1,
            sectorType: 1,
            revenue: 1,
            corporationId: 1,
            nationalizedAtTurn: 1,
            mothballed: 1,
          },
        }
      )
      .toArray(),
  ]);
  const stateControlled = computeStateControlledBuckets(globalSectors, nationalCorpIds);

  // Rival index for capacity-decision telemetry, off the already-loaded
  // `globalSectors` snapshot: no turn-path reads. See capacityDecisionTelemetry.
  const competitorsByBucket = buildCapacityCompetitorIndex(globalSectors);

  return { globalSectors, stateControlled, competitorsByBucket };
}

export async function loadNppPlantsDecisionContext(
  db: Db,
  turn: number,
  nppCorps: readonly Corporation[],
  globalSectors: CorporateSector[],
  plantsEnabled: boolean
) {
  let plants: NppPlantsContext | undefined;
  let bankRates: RelocationPrimeBank[] | undefined;
  if (plantsEnabled) {
    const gsPlants = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, startingYear: 1, currentTurn: 1, preset: 1 } }
      );
    const plantsYear =
      gsPlants?.currentYear ??
      (gsPlants?.startingYear ?? STARTING_YEAR) +
        Math.floor(((gsPlants?.currentTurn ?? turn) - 1) / TURNS_PER_YEAR);

    const countryIds = [...new Set(nppCorps.map((c) => c.countryId))];
    // Bank rates are fixed during this phase; reuse this snapshot for quotes.
    const bankSnapshot = await loadNppBankRateSnapshot(db, countryIds);
    bankRates = bankSnapshot.bankRates;
    const primeByCountry = bankSnapshot.primeByCountry;
    const colByState = await loadNppCostOfLivingByState(db);
    const nationalShareOf = buildNppNationalShareResolver(globalSectors);
    plants = {
      enabled: true,
      year: plantsYear,
      eraUnitScale: await loadWorldEraUnitScale(db),
      preset: resolvePresetIdFromGameState(gsPlants),
      primeRateOf: (cid) => primeByCountry.get(cid) ?? 0,
      costOfLivingOf: (sid) => colByState.get(sid) ?? null,
      nationalShareOf,
    };
  }
  return { plants, bankRates };
}

export async function loadNppDecisionFxRates(db: Db) {
  // Local-per-₳ rates for every live currency, loaded once. NPP money constants
  // are all ₳; `liquidCapital` is not. See `NppCorpDecisionContext.fxRate`.
  const fxByCurrency = new Map<string, number>();
  for (const rate of await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()) {
    if (rate.currencyCode && typeof rate.rate === "number" && rate.rate > 0) {
      fxByCurrency.set(rate.currencyCode, rate.rate);
    }
  }

  return fxByCurrency;
}
