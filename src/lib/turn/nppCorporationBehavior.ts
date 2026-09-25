import type { Db, ObjectId } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  SectorBuildOrder,
  StateMetrics,
  GameState,
  ExchangeRate,
} from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { netPerTurnDebtServiceAnchor } from "@/lib/bonds/corpBondCashflows";
import {
  buildActiveMarketBuckets,
  hasEnterableHeadroom,
  sectorShortageScore,
  sectorPeakShortageScore,
  ESSENTIAL_SHORTAGE_SCORE,
  markMarketsActive,
  computeMacroProductionPolicy,
  type CommodityPriceRatioFn,
  type PlacementSignals,
} from "@/lib/turn/npp/marketSignals";

export {
  sectorShortageScore,
  computeMacroProductionPolicy,
  type CommodityPriceRatioFn,
} from "@/lib/turn/npp/marketSignals";
import {
  advanceStrategy,
  strategyLevers,
  type StrategySituation,
} from "@/lib/turn/npp/corpStrategy";
import { chooseNppStrategyRetool } from "@/lib/turn/npp/strategyRetooling";
import { glutStaggerEligible } from "@/lib/turn/npp/cohort";
import {
  analyzeSectorProfitability,
  type SectorProfitInfo,
} from "@/lib/turn/npp/sectorProfitability";
import { chooseCostMothballSector, lossChronicityUpdates } from "@/lib/turn/npp/costMothball";
export { GLUT_STATE_CHANGE_STAGGER, glutStaggerEligible } from "@/lib/turn/npp/cohort";
export {
  STRATEGY_SHIFT_MARGIN_TRIGGER,
  STRATEGY_SHIFT_MIN_ADVANTAGE,
  STRATEGY_SHIFT_PROFIT_SEEK_ADVANTAGE,
  strategyPriceScore,
} from "@/lib/turn/npp/strategyRetooling";
import type { NPP } from "@/lib/db/types/npp";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import {
  deriveCeoArchetype,
  ceoArchetypeModifiers,
  type CeoArchetype,
} from "@/lib/turn/ceoArchetype";
import type { CorporationType } from "@/lib/constants/corporations";
import { partitionOpenMarkets } from "@/lib/economy/queries/privateEnterpriseGate";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import {
  STRANDED_DIVEST_TURNS,
  STRANDED_DIVEST_MAX_PER_TURN,
} from "@/lib/corporations/strandedPlant";
import { labourAtLeast, isLabourSystemMode } from "@/lib/labour/modes";
import { CHRONIC_LOW_FILL_THRESHOLD } from "@/lib/turn/npp/strategyExpectedRevenue";
import {
  bucketKey,
  computeStateControlledBuckets,
  loadNationalCorpIds,
} from "@/lib/nationalization/stateControlledBuckets";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import type { BuildCapexTxInput } from "@/lib/corporations/capexTxLog";
import { buildNppCorpUpdateOp } from "@/lib/turn/npp/nppCashWrite";
import { getLogisticsSupportedSectorCount } from "@/lib/constants/corporations";
import {
  CAPACITY_BUILD_TURNS,
  computeBuildCost,
  MAX_BUILD_UNITS_PER_ORDER,
  revenuePerCapacityUnit,
} from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { buildNppPriceSignals } from "@/lib/turn/npp/priceSignals";
import type { RelocationPrimeBank } from "@/lib/corporations/issueRelocationBond";
import { loadNppBankRateSnapshot } from "@/lib/turn/npp/bankRateSnapshot";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import {
  anchorToCorpCapital,
  resolveSectorHostCurrencyCode,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CapacityDecisionObservation } from "@/lib/corporations/capacityDecisionTelemetry/rules";
import {
  buildNppOperatorObservation,
  type NppDecisionConstraint,
  type NppOperatorObservation,
} from "@/lib/corporations/nppOperatorTelemetry/rules";
import {
  buildCapacityCompetitorIndex,
  createFoundingCapacityOutcome,
  createReinvestCapacityObserver,
  evaluateReinvestPreSizingGate,
  makeCapacityCashToAnchor,
  makeCapacityCompetitorCounter,
  mergeCapacityObservations,
  noteFoundingCapacityOutcome,
  pushFoundingCapacityObservation,
  resolveCapacityCohort,
} from "@/lib/turn/npp/capacityDecisionTelemetry";
import {
  createReinvestPoolLookup,
  reinvestPoolHeadroomUnits,
  type ReinvestCandidate,
} from "@/lib/turn/npp/reinvestCandidatePool";
import { pushNppWageUpdates } from "@/lib/turn/npp/nppWagePolicy";
import {
  appendNppReinvestCapexRows,
  buildNppFoundedSectorInserts,
  depleteUnownedPoolsForDraws,
  drawFoundedCapacityFromPools,
  flushNppCapacityWriteback,
} from "@/lib/turn/npp/capacityWriteback";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { getNppCashFloorAnchor } from "@/lib/turn/npp/nppCashReserve";
import { loadNppBehaviorConfig } from "@/lib/turn/npp/behaviorConfig";
import { maybePushNppTechUnlock } from "@/lib/turn/npp/corpBehaviorConfig";
import { corpDailyGrossRevenueLocalFromSectors } from "@/lib/corporations/dailyGrossRevenue";
import type { TechUnlockLedgerInput } from "@/lib/corporations/techTree/techUnlockLedger";
import {
  fragileReinvestmentPriority,
  loadNppPlacementSignals,
} from "@/lib/turn/npp/fragileMarketSupply";
import {
  resolveFoundingShortfallReason,
  resolveNppMarketEntryCredit,
  setNppMarketEntryReason,
  type NppMarketEntryDiagnostic,
} from "@/lib/turn/npp/entryDiagnostics";
import { evaluateNppEntry } from "@/lib/turn/npp/entryEvaluation";
import {
  createFrontierEntryTurnState,
  evaluateFrontierCandidate,
  settleFrontierEntryPlacement,
} from "@/lib/turn/npp/frontierEntryCandidate";
import type {
  NppCorpDecision,
  NppCorpDecisionContext,
  NppPlantsContext,
  NppSectorUpdateDoc,
} from "@/lib/turn/npp/corpDecisionTypes";
import {
  loadNppCorporationBondLookups,
  type NppCorporationDecisionPreload,
} from "@/lib/turn/npp/nppCorporationBondLookups";

export type { NppPlantsContext } from "@/lib/turn/npp/corpDecisionTypes";

export { computeExtractionHeadroomByState } from "@/lib/turn/nppExtractionOpportunity";

import {
  GROWTH_COST_MARGIN_SHARE,
  NPP_REINVEST_AGGRESSION,
  NPP_REINVEST_MIN_FILL,
  NPP_REINVEST_MAX_QUEUE_DEPTH,
  NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH,
  NPP_GROWTH_DEPLOY_FRACTION,
  NPP_GROWTH_MIN_SHORTAGE,
  NPP_GROWTH_MIN_UTILIZATION,
  NPP_GROWTH_MAX_STEP_OF_RUN,
  NPP_REINVEST_MAX_SECTORS_PER_TURN,
  NPP_REINVEST_MAINTENANCE_CASH_SHARE,
  EXPANSION_COST,
  EXPANSION_MIN_CASH,
  EXPANSION_MIN_MARGIN,
  NPP_SHORTAGE_ENTRIES_PER_TURN,
  NPP_FOUNDING_DEPLOY_FRACTION,
  NPP_FOUNDING_HEADROOM_SHARE,
  NPP_EXTRACTION_FOUNDING_MAX_FACILITIES,
  MAX_DIVIDEND_RATE,
  DEFAULT_ARCHETYPE,
  GLUT_MOTHBALL_FILL_THRESHOLD,
  GLUT_MOTHBALL_PRICE_RATIO,
  GLUT_RESTART_PRICE_RATIO,
  COST_MOTHBALL_LOSS_TURNS,
} from "@/lib/turn/npp/nppCorporationTuning";

export {
  NPP_GROWTH_MIN_SHORTAGE,
  NPP_GROWTH_MIN_UTILIZATION,
  NPP_GROWTH_MAX_STEP_OF_RUN,
  NPP_SHORTAGE_ENTRIES_PER_TURN,
  NPP_FOUNDING_DEPLOY_FRACTION,
  NPP_FOUNDING_HEADROOM_SHARE,
};

export async function processNppCorporationDecisions(
  db: Db,
  turn: number,
  now: Date,
  techTreesEnabled: boolean = false,
  preloaded?: NppCorporationDecisionPreload
): Promise<{
  corpUpdates: Array<{
    filter: { _id: ObjectId; unlockedTechNodeIds?: { $ne: string } };
    update: {
      $set?: Record<string, unknown>;
      $inc?: Record<string, number>;
      $addToSet?: { unlockedTechNodeIds: string };
    };
  }>;
  sectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }>;
  newSectors: Array<Omit<CorporateSector, "_id"> & { _id: ObjectId }>;
  divestedSectorIds: ObjectId[];
  techLedger: TechUnlockLedgerInput[];
}> {
  const nppCorps = preloaded
    ? preloaded.corporations.filter((corp) => corp.ceoType === "npp" && corp.suspended !== true)
    : await db
        .collection<Corporation>("corporations")
        .find({ ceoType: "npp", suspended: { $ne: true } })
        .toArray();

  const corpUpdates: Array<{
    filter: { _id: ObjectId; unlockedTechNodeIds?: { $ne: string } };
    update: {
      $set?: Record<string, unknown>;
      $inc?: Record<string, number>;
      $addToSet?: { unlockedTechNodeIds: string };
    };
  }> = [];
  const allSectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }> = [];
  const newSectors: Array<Omit<CorporateSector, "_id"> & { _id: ObjectId }> = [];
  const allDivestedSectorIds: ObjectId[] = [];
  const techLedger: TechUnlockLedgerInput[] = [];
  const operatorObservations: NppOperatorObservation[] = [];

  if (nppCorps.length === 0)
    return {
      corpUpdates,
      sectorUpdates: allSectorUpdates,
      newSectors,
      divestedSectorIds: allDivestedSectorIds,
      techLedger,
    };

  const corpIds = nppCorps.map((c) => c._id);
  // Resolve each corp's CEO NPP so its personality can shape the corp's behavior.
  // ceoId holds the NPP _id when ceoType === "npp".
  const ceoNppIds = nppCorps.filter((c) => c.ceoType === "npp" && c.ceoId).map((c) => c.ceoId);
  // All four reads depend only on the NPP cohort. Start them together rather
  // than making the decision phase wait for each collection in sequence.
  const [allSectors, ceoNpps, commodityPriceDocs, unownedSectors] = await Promise.all([
    db
      // full-read(corporateSectors): buildQueue and plantsPnl drive NPP build and divest decisions
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: { $in: corpIds } })
      .toArray(),
    ceoNppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: ceoNppIds } }, { projection: { personality: 1 } })
          .toArray()
      : Promise.resolve([]),
    db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
    db.collection<UnownedSector>("unownedSectors").find({}).toArray(),
  ]);
  const archetypeByNppId = new Map<string, CeoArchetype>();
  for (const npp of ceoNpps) {
    if (npp.personality) {
      archetypeByNppId.set(npp._id.toString(), deriveCeoArchetype(npp.personality));
    }
  }

  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const sector of allSectors) {
    const cid = sector.corporationId.toString();
    if (!sectorsByCorp.has(cid)) sectorsByCorp.set(cid, []);
    sectorsByCorp.get(cid)!.push(sector);
  }

  // Commodity price snapshot for macro-aware production policy (SP5). One doc
  // per commodity; keep the latest turn if duplicates exist.
  const priceByCommodity = new Map<string, CommodityPrice>();
  for (const doc of commodityPriceDocs) {
    const existing = priceByCommodity.get(doc.commodity);
    if (!existing || (doc.turn ?? 0) >= (existing.turn ?? 0)) {
      priceByCommodity.set(doc.commodity, doc);
    }
  }
  const { priceRatioOf, statePriceRatioOf } = buildNppPriceSignals(priceByCommodity);

  const placementSignals = await loadNppPlacementSignals(db, turn, allSectors, statePriceRatioOf);

  const { open: openUnowned, blocked } = await partitionOpenMarkets(db, unownedSectors);

  // Index unowned sectors by countryId for fast lookup
  const unownedByCountry = new Map<string, UnownedSector[]>();
  for (const us of openUnowned) {
    if (!unownedByCountry.has(us.countryId)) unownedByCountry.set(us.countryId, []);
    unownedByCountry.get(us.countryId)!.push(us);
  }
  // Shared object references let each founding deplete later candidates in this pass.
  const unownedIndex = new Map<string, UnownedSector>();
  for (const us of openUnowned) {
    unownedIndex.set(bucketKey(us.stateId, us.sectorType), us);
  }

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
  placementSignals.activeMarketBuckets = buildActiveMarketBuckets(globalSectors);

  // Rival index for capacity-decision telemetry, off the already-loaded
  // `globalSectors` snapshot: no turn-path reads. See capacityDecisionTelemetry.
  const competitorsByBucket = buildCapacityCompetitorIndex(globalSectors);

  // Resolve the shared plants pricing context once for the cohort.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
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
    const colDocs = await db
      .collection<StateMetrics>("macroMetrics")
      .find({}, { projection: { "economic.costOfLiving": 1 } })
      .toArray();
    const colByState = new Map<string, number>();
    for (const doc of colDocs) {
      const value = doc.economic?.costOfLiving?.value;
      if (typeof value === "number" && Number.isFinite(value)) {
        colByState.set(String(doc._id), value);
      }
    }
    plants = {
      enabled: true,
      year: plantsYear,
      eraUnitScale: await loadWorldEraUnitScale(db),
      preset: resolvePresetIdFromGameState(gsPlants),
      primeRateOf: (cid) => primeByCountry.get(cid) ?? 0,
      costOfLivingOf: (sid) => colByState.get(sid) ?? null,
    };
  }
  const unownedDraws: NonNullable<NppCorpDecision["unownedDraws"]> = [];
  // Capacity-decision observations, aggregated in memory and flushed once for
  // the whole cohort below: no per-row turn queries, no new reads.
  const capacityObservations: CapacityDecisionObservation[] = [];
  const capexRows: BuildCapexTxInput[] = [];
  const entryDiagnostics: NppMarketEntryDiagnostic[] = [];

  // Resolve the world's current decade once for NPP tech-tree auto-picks.
  let techCurrentYear = 0;
  if (techTreesEnabled) {
    const gs = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentYear: 1, startingYear: 1, currentTurn: 1 } }
      );
    const startingYear = gs?.startingYear ?? STARTING_YEAR;
    techCurrentYear =
      gs?.currentYear ??
      startingYear + Math.floor(((gs?.currentTurn ?? turn) - 1) / TURNS_PER_YEAR);
  }

  // Local-per-₳ rates for every live currency, loaded once. NPP money constants
  // are all ₳; `liquidCapital` is not. See `NppCorpDecisionContext.fxRate`.
  const fxByCurrency = new Map<string, number>();
  for (const rate of await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()) {
    if (rate.currencyCode && typeof rate.rate === "number" && rate.rate > 0) {
      fxByCurrency.set(rate.currencyCode, rate.rate);
    }
  }

  // ─── Debt service, loaded once for the cohort ─────────────────────────────
  // Same two maps `buildCorporationLookups` builds for the turn engine, and the
  // same helpers it charges with, so the brain reads the number the engine
  // actually bills rather than an approximation of it. Issuer side is corporate
  // bonds only; holder side keeps sovereigns, because a corp parking cash in
  // treasuries genuinely collects that coupon.
  const { issuerBondsByCorpId, heldBondsByCorpId } = await loadNppCorporationBondLookups(
    db,
    preloaded
  );

  // Cohort-wide kill switch, read once. Absent means ON.
  const strategyGate = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { nppCorpStrategyEnabled: 1, frontierEntryExperimentEnabled: 1 } }
    );
  const strategyLoopEnabled = strategyGate?.nppCorpStrategyEnabled !== false;
  // Frontier-entry experiment turn state (issue #991). See
  // createFrontierEntryTurnState: fail-closed, no new turn-path round trip.
  const frontierEntryTurn = createFrontierEntryTurnState(
    strategyGate?.frontierEntryExperimentEnabled
  );

  const { labourMode, retailExpansionPaused } = await loadNppBehaviorConfig(db, turn);
  const labourWagesEnabled = isLabourSystemMode(labourMode) && labourAtLeast(labourMode, "wages");

  for (const corp of nppCorps) {
    const sectors = sectorsByCorp.get(corp._id.toString()) ?? [];
    const archetype =
      (corp.ceoId && archetypeByNppId.get(corp.ceoId.toString())) || DEFAULT_ARCHETYPE;
    const corpCurrency = resolveCorpLiquidCurrencyCode(corp);
    const corpFxRate = (corpCurrency && fxByCurrency.get(corpCurrency)) || 1;
    const entryCohortEligible = glutStaggerEligible(corp._id.toString(), turn);
    const decisionContext: NppCorpDecisionContext = {
      corp,
      sectors,
      turn,
      now,
      fxRate: corpFxRate,
      competitorCountOf: makeCapacityCompetitorCounter(competitorsByBucket),
      fxByCurrency,
      strategy: corp.nppStrategy,
      strategyEligible: entryCohortEligible,
      ordinaryEntryEligible: entryCohortEligible,
      shortageEntryEligible: entryCohortEligible,
      retailExpansionPaused,
      caretakerMandate: corp.caretakerCeo?.mandate ?? "active",
      strategyLoopEnabled,
      debtServiceAnchor: netPerTurnDebtServiceAnchor({
        issuerBonds: issuerBondsByCorpId.get(corp._id.toString()),
        heldPositions: heldBondsByCorpId.get(corp._id.toString()),
        fxByCurrency: fxByCurrency as ReadonlyMap<CurrencyCode, number>,
        // The government bond subsidy waives issuer interest for national
        // enterprises, exactly as `perTurnBondDragOnNetIncome` does.
        isNationalEnterprise: !!corp.countryOwnerId,
      }),
      modifiers: ceoArchetypeModifiers(archetype),
      labourWagesEnabled,
      currentYear: techCurrentYear > 0 ? techCurrentYear : undefined,
      techTreesEnabled,
      frontierEntry: frontierEntryTurn,
    };
    let decision = makeNppCorpDecision(
      decisionContext,
      unownedByCountry,
      stateControlled,
      priceRatioOf,
      plants,
      placementSignals
    );

    decision = await resolveNppMarketEntryCredit({
      db,
      corporation: corp,
      decision,
      turn,
      fxByCurrency: fxByCurrency as ReadonlyMap<CurrencyCode, number>,
      bankRates,
      corpFxRate,
      retry: (creditLocal) =>
        makeNppCorpDecision(
          { ...decisionContext, shortageEntryCreditLocal: creditLocal },
          unownedByCountry,
          stateControlled,
          priceRatioOf,
          plants,
          placementSignals
        ),
    });
    markMarketsActive(placementSignals, decision.newSectors);
    if (decision.entryDiagnostic) entryDiagnostics.push(decision.entryDiagnostic);
    // Cohort telemetry aggregate (credit-rewrite included); see capacityDecisionTelemetry.
    mergeCapacityObservations(
      capacityObservations,
      decision.capacityObservations,
      decision.entryDiagnostic?.reason
    );
    if (decision.operatorObservation) operatorObservations.push(decision.operatorObservation);
    if (decision.reinvestments && corpCurrency) {
      appendNppReinvestCapexRows(capexRows, {
        corp,
        corpCurrency,
        reinvestments: decision.reinvestments,
        turn,
        now,
      });
    }

    if (decision.unownedDraws) {
      unownedDraws.push(...decision.unownedDraws);
      // Deplete the shared snapshot in lockstep so later corps see what is left.
      depleteUnownedPoolsForDraws(unownedIndex, decision.unownedDraws, plants?.eraUnitScale ?? 1);
    }

    // Gated inside the builder, not on `updates` alone: the cash leg no longer
    // lives in `updates`, so a decision whose only effect is a spend would be
    // dropped by an `Object.keys(updates).length > 0` check (ticket #1260).
    const corpUpdateOp = buildNppCorpUpdateOp(decision);
    if (corpUpdateOp) corpUpdates.push(corpUpdateOp);

    // Budget tech from post-decision cash and preserve the same safety floor.
    if (techTreesEnabled && decisionContext.caretakerMandate !== "passive") {
      maybePushNppTechUnlock({
        corp,
        dailyGrossRevenueLocal: corpDailyGrossRevenueLocalFromSectors(sectors, corp, {
          plantsEnabled,
          eraUnitScale: plants?.eraUnitScale ?? 1,
          fxByCurrency: fxByCurrency as ReadonlyMap<CurrencyCode, number>,
        }),
        techCurrentYear,
        turn,
        now,
        corpUpdates,
        liquidCapitalDelta: decision.liquidCapitalDelta,
        cashReserve: decision.cashFloorLocal,
        techLedger,
      });
    }

    if (decision.strategy) {
      corpUpdates.push({
        filter: { _id: corp._id },
        update: { $set: { nppStrategy: decision.strategy, updatedAt: now } },
      });
    }

    allSectorUpdates.push(...decision.sectorUpdates);

    if (decision.newSectors) {
      newSectors.push(
        ...buildNppFoundedSectorInserts({
          corporationId: corp._id,
          newSectors: decision.newSectors,
          blocked,
          turn,
          now,
        })
      );
    }

    if (decision.divestedSectorIds) {
      allDivestedSectorIds.push(...decision.divestedSectorIds);
    }
  }

  await drawFoundedCapacityFromPools(db, unownedDraws, {
    eraUnitScale: plants?.eraUnitScale ?? 1,
    now,
  });
  await flushNppCapacityWriteback(db, {
    turn,
    now,
    entryDiagnostics,
    capexRows,
    capacityObservations,
    operatorObservations,
  });

  return {
    corpUpdates,
    sectorUpdates: allSectorUpdates,
    newSectors,
    divestedSectorIds: allDivestedSectorIds,
    techLedger,
  };
}

export function makeNppCorpDecision(
  ctx: NppCorpDecisionContext,
  unownedByCountry: Map<string, UnownedSector[]>,
  stateControlled: ReadonlySet<string>,
  priceRatioOf: CommodityPriceRatioFn,
  plants?: NppPlantsContext,
  placementSignals?: PlacementSignals
): NppCorpDecision {
  const { corp, sectors, now, modifiers } = ctx;
  const updates: Record<string, unknown> = { updatedAt: now };
  const sectorUpdates: NppCorpDecision["sectorUpdates"] = [];
  const newSectors: NppCorpDecision["newSectors"] = [];
  const divestedSectorIds: ObjectId[] = [];
  const unownedDraws: NonNullable<NppCorpDecision["unownedDraws"]> = [];
  const reinvestments: NonNullable<NppCorpDecision["reinvestments"]> = [];
  let shortageCreditRequest: NppCorpDecision["shortageCreditRequest"];
  let entryDiagnostic: NppCorpDecision["entryDiagnostic"];

  const liquidCapital = corp.liquidCapital ?? 0;
  const passive = ctx.caretakerMandate === "passive";
  let cashLocal = liquidCapital;
  const numSectors = sectors.length;

  const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corp);
  const corpFxRate = ctx.fxRate ?? 1;
  const toCorpLocal = (amountAnchor: number): number =>
    anchorToCorpCapital(amountAnchor, corpCurrencyCode, corpFxRate);
  const cashToAnchor = makeCapacityCashToAnchor(corp, corpFxRate);
  const capacityCohort = resolveCapacityCohort(corp);
  const capacityObservations: CapacityDecisionObservation[] = [];
  // Which of the four operator decision legs bound this corp this turn (#2122);
  // sections below flag the branch they take and the resolver picks the first.
  const constraintFlags: Partial<Record<NppDecisionConstraint, boolean>> = {};
  const ownCorporationId = corp._id.toString();
  const rivalCount = (stateId: string, sectorType: string): number =>
    ctx.competitorCountOf?.(stateId, sectorType, ownCorporationId) ?? 0;
  const sectorEconomicToCorpLocal = (amount: number, sector: CorporateSector): number => {
    const hostCurrency = resolveSectorHostCurrencyCode(sector, corp);
    const hostRate =
      (hostCurrency && ctx.fxByCurrency?.get(hostCurrency)) ??
      (hostCurrency === corpCurrencyCode ? corpFxRate : 1);
    return toCorpLocal(readCorpEconomicAnchor(amount, hostCurrency, hostRate));
  };

  // Archetype-adjusted levers, each clamped to a safe rail so no personality can
  // bankrupt a profitable corp. Clamped in ₳ (where the rails are authored),
  // then converted once into the currency `liquidCapital` is compared in.
  const effectiveCashFloor = toCorpLocal(
    getNppCashFloorAnchor(plants?.enabled ? plants.preset : undefined, modifiers.cashFloorMult)
  );
  const effectiveExpansionMinMargin = EXPANSION_MIN_MARGIN * modifiers.expansionMinMarginMult;
  const effectiveExpansionMinCash = toCorpLocal(
    EXPANSION_MIN_CASH * modifiers.expansionMinCashMult
  );

  // ── Profitability analysis ─────────────────────────────────────────────────
  const sectorProfits = analyzeSectorProfitability(sectors, plants?.enabled === true);
  const profitableSectors = sectorProfits.filter((sp) => sp.isProfitable).length;

  // Count consecutive loss turns for active NPP sectors. Restart resets the count.
  if (plants?.enabled === true) {
    sectorUpdates.push(...lossChronicityUpdates(sectorProfits, now));
  }

  // `totalIncome`/`totalRevenue`/`corpMargin`/`isProfitable` below feed ONLY
  // sections 3-5 (budgets, dividends, expansion) — never sections 1-2, which
  // read sp.income/sp.margin directly. Three compounding bugs made those
  // sections spend a corp into the ground while reading it as healthy:
  //
  // (1) Blind to its own overhead. The old figures were pure SECTOR income —
  //     before the very marketing/logistics/R&D/CEO-salary spend section 3 was
  //     about to size — so an NPP kept raising overhead while real income fell.
  //     Measured on a stopped 657-turn world: totalCosts/revenue rose 0.49 →
  //     1.19 and 89% of corps were loss-making, while sector
  //     effectiveProfitMargin held flat at 45-60. Fix: subtract last turn's
  //     ACTUAL spend (below) before judging profitability.
  //
  // (2) Sized off the wrong revenue. `sector.revenue` is NOMINAL (book) revenue;
  //     the corp collects `realizedRevenue` and pays overhead out of it. Sizing
  //     budgets off nominal while charging them against realized multiplies the
  //     true burden by 1/realizationRatio (measured ~3×). Use realizedRevenue.
  //
  // (3) Blind to its own debt. Bond interest is contracted, not discretionary,
  //     and was absent, so an operating-profitable corp could lose money every
  //     turn while reading healthy. See NppCorpDecisionContext.debtServiceAnchor.
  //     Charged in the corp's own currency, like every other money constant here.
  const realizedOrNominal = (sp: SectorProfitInfo) =>
    sectorEconomicToCorpLocal(sp.sector.realizedRevenue ?? sp.sector.revenue ?? 0, sp.sector);
  const totalRevenue = sectorProfits.reduce((sum, sp) => sum + realizedOrNominal(sp), 0);
  const grossRealizedIncome = sectorProfits.reduce(
    (sum, sp) => sum + realizedOrNominal(sp) * (sp.margin / 100),
    0
  );
  const priorOverhead =
    (corp.marketingBudget ?? 0) +
    (corp.logisticsBudget ?? 0) +
    (corp.rdBudget ?? 0) +
    (corp.ceoSalary ?? 0);
  const debtServiceLocal = toCorpLocal(ctx.debtServiceAnchor ?? 0);
  const totalIncome = grossRealizedIncome - priorOverhead - debtServiceLocal;
  const corpMargin = totalRevenue > 0 ? (totalIncome / totalRevenue) * 100 : 0;
  const isProfitable = totalIncome > 0 && profitableSectors > 0;

  // ── v5 strategy loop ───────────────────────────────────────────────────────
  // The score is `corpMargin` itself: already currency-normalized, scale-free,
  // and net of both overhead and debt service. One number, comparable across
  // countries and eras, unlike every money constant in this module.
  //
  // Everything below only RE-WEIGHTS levers that already existed. `expand` is
  // the identity, so a corp that is doing fine never changes behaviour.
  const debtDominant = debtServiceLocal > 0 && debtServiceLocal >= grossRealizedIncome;
  const lowFillSectors = sectorProfits.filter(
    (sp) => sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD
  ).length;
  const situation: StrategySituation = {
    score: corpMargin,
    debtDominant,
    // "Mostly cannot sell what it makes": a majority of the corp's sectors.
    chronicLowFill: sectorProfits.length > 0 && lowFillSectors * 2 > sectorProfits.length,
    hasHeadroom: hasEnterableHeadroom(
      corp,
      sectors,
      unownedByCountry,
      stateControlled,
      plants?.enabled === true,
      plants?.eraUnitScale ?? 1
    ),
    // Derived from the corp, NOT passed in. An `isCaretaker` the caller had
    // to remember to set is one more way to get this wrong, which is the
    // exact bug class this module keeps producing: the seeded-margin read,
    // the nominal-revenue read, the unconverted foreign revenue. The corp
    // document already knows.
    isCaretaker: !!corp.caretakerCeo,
  };
  // Absent reads as enabled: see `strategyLoopEnabled`. When off, the corp runs
  // the `expand` levers and no strategy state is written, so an operator can
  // kill the loop mid-world without a revert and without leaving stale memory
  // that would resume the moment it is re-enabled.
  const strategyLoopOn = ctx.strategyLoopEnabled !== false;
  const strategyDecision = strategyLoopOn
    ? advanceStrategy({
        prior: ctx.strategy,
        turn: ctx.turn,
        situation,
        eligible: ctx.strategyEligible === true,
      })
    : null;
  const levers = strategyLevers(strategyDecision?.state.id ?? "expand");

  // ── 1. Divest losing sectors ──────────────────────────────────────────────
  // Divest a losing sector once its margin falls to/below the archetype's
  // tolerance (impatient archetypes shed at the first loss; patient ones tolerate
  // shallow losses) and the corp has other profitable sectors — BUT never divest
  // the corp's primary type (core business).
  if (numSectors > 1) {
    for (const sp of sectorProfits) {
      if (
        sp.income < 0 &&
        sp.margin <= modifiers.divestMarginFloor + levers.divestMarginFloorDelta
      ) {
        // Protect the corp's primary sector type — that's its core business
        if (sp.sector.sectorType === corp.type) {
          constraintFlags.divest_core_protected = true;
          continue;
        }

        const remainingProfitable = profitableSectors;
        if (remainingProfitable > 0) {
          divestedSectorIds.push(sp.sector._id);
        } else {
          constraintFlags.divest_no_other_income = true;
        }
      }
    }
  }

  // ── 1b. Divest stranded plants (supply-dislocation phase 2) ───────────────
  // A plant that has cleared less than half its output for STRANDED_DIVEST_TURNS
  // straight is built in the wrong place, and margin cannot see it: the units
  // that DO sell carry a healthy margin while most of the output evaporates.
  // Exit it so the corp's next founding (state-aware since P1) rebuilds where
  // the demand is. Same protections as the margin divest — never the corp's
  // core type, never the last sector, only while something else is profitable —
  // plus a one-per-turn cap so exits stay gradual. Capacity is deliberately not
  // restored to the unowned pool: the state is glutted, re-listing the bucket
  // would invite the next founding straight back in.
  if (plants?.enabled && numSectors > 1 && profitableSectors > 0) {
    let strandedDivests = 0;
    // Longest-stranded first, so the cap exits the worst plant.
    const stranded = sectorProfits
      .filter(
        (sp) =>
          (sp.sector.lowFillTurns ?? 0) >= STRANDED_DIVEST_TURNS &&
          sp.sector.sectorType !== corp.type &&
          sp.sector.mothballed !== true &&
          !divestedSectorIds.includes(sp.sector._id)
      )
      .sort((a, b) => (b.sector.lowFillTurns ?? 0) - (a.sector.lowFillTurns ?? 0));
    for (const sp of stranded) {
      if (strandedDivests >= STRANDED_DIVEST_MAX_PER_TURN) break;
      if (numSectors - divestedSectorIds.length <= 1) break;
      divestedSectorIds.push(sp.sector._id);
      strandedDivests += 1;
    }
  }

  // Divest-leg flag (section 1): a completed shed; blocked-shed flags are set
  // inside the margin-divest loop above.
  if (divestedSectorIds.length > 0) constraintFlags.divested = true;

  // Effective sector count after divestiture
  const effectiveSectors = numSectors - divestedSectorIds.length;
  const logisticsSupportedSectors = getLogisticsSupportedSectorCount(corp.logisticsStrength);

  // ── 2. Growth rate adjustment (per-sector) ────────────────────────────────
  // Aggressive: strong sectors get +2, healthy +1, thin stays, loss -2.
  // Then a macro tilt (smarter-NPP, t879): the margin signal alone floods
  // gluts (a strong-margin sector in a deep glut still accelerated) and
  // starves shortages (a thin sector selling a scarce commodity never grew).
  // Shortage outputs get +1 growth, deep-glut outputs −1, so NPP capacity
  // chases unmet demand instead of pure own-margin momentum.
  for (const sp of sectorProfits) {
    // Skip sectors being divested
    if (divestedSectorIds.includes(sp.sector._id)) continue;
    // A mothballed plant is deliberately idle (section 2c): growth targets are
    // meaningless while it's cold, and its stale margin would only add noise.
    if (sp.sector.mothballed === true) continue;
    // Plants: growth targets are vestigial — sectorTurn zeroes them every
    // turn, so adjusting them here is write churn with no reader. The AI
    // grows via section 6 reinvestment build orders instead.
    if (plants?.enabled) continue;

    // Fill-awareness (t899): lagged soldFraction is only set under clearing
    // mode. A sector that sold < CHRONIC_LOW_FILL_THRESHOLD of its output last
    // turn must not expand — more output would just go unsold. The strategy
    // brain (extractionAutoStrategy pass 2) handles re-pointing it at higher
    // expected revenue; here we only stop it digging deeper.
    const chronicLowFill =
      sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD;

    let targetGrowth = sp.sector.targetGrowthRate ?? 2;

    // Growth must pay for itself. The category ladder below keys on MARGIN, but
    // margin alone does not tell you whether expanding is affordable: growth
    // cost is charged as a share of revenue, so a sector can hold a healthy
    // 25% margin and still lose money once a 21%-of-revenue growth bill lands
    // on top of 75% maintenance. Measured mid-run, that is exactly where firms
    // sat — margin 25, growth cost 21%, income negative — and because 25 reads
    // as "strong" the governor kept ADDING growth every turn, deepening the
    // loss it was supposed to correct.
    //
    // So: never increase growth when the sector's own growth bill already eats
    // its margin, and back off when it clearly exceeds it. A firm with real
    // headroom still expands; one paying more to grow than it earns stops.
    const sectorRevenue = sp.sector.revenue ?? 0;
    const growthCostShare =
      sectorRevenue > 0 ? (100 * (sp.sector.currentGrowthCost ?? 0)) / sectorRevenue : 0;
    // Growth may consume at most HALF the gross margin. Comparing it to the
    // whole margin was too permissive: measured mid-run at margin 27.2 with
    // growth cost 21.4% of revenue, the test passed (21.4 < 27.2) while the
    // firm was plainly losing money — maintenance takes (100 - margin) = 72.8%,
    // so margin plus growth already consumed 94.2% of revenue before any
    // corporate overhead, and average income sat at -13.4k with 67% of firms
    // loss-making. Requiring real headroom is what makes the governor bite: as
    // growth falls its cost falls, so the rule is self-correcting rather than a
    // fixed target.
    const growthUnaffordable = growthCostShare >= sp.margin * GROWTH_COST_MARGIN_SHARE;

    if (growthUnaffordable) {
      constraintFlags.growth_unaffordable = true;
      targetGrowth = Math.max(0, targetGrowth - 1);
    } else if (sp.marginCategory === "loss") {
      constraintFlags.loss_margin = true;
      targetGrowth = Math.max(0, targetGrowth - 2);
    } else if (sp.marginCategory === "strong") {
      targetGrowth = Math.min(5, targetGrowth + 2 + modifiers.growthDelta + levers.growthDelta);
    } else if (sp.marginCategory === "healthy") {
      targetGrowth = Math.min(5, targetGrowth + 1 + modifiers.growthDelta + levers.growthDelta);
    }
    // Thin margin → keep current target

    // State-resolution shortage (supply-dislocation P1b): the country blend
    // hid exactly the dislocation this tilt exists to correct — a plant in a
    // glutted state kept growing because OTHER states' shortage pulled the
    // national ratio up. Score the plant's own state, country fallback.
    const shortage = sectorShortageScore(
      sp.sector.sectorType,
      sp.sector.countryId ?? corp.countryId,
      (commodity, cid) =>
        placementSignals?.statePriceRatioOf?.(commodity, sp.sector.stateId) ??
        priceRatioOf(commodity, cid)
    );
    if (shortage >= 1.15 && sp.marginCategory !== "loss" && !growthUnaffordable) {
      targetGrowth = Math.min(5, targetGrowth + 1);
    } else if (shortage <= 0.85) {
      constraintFlags.glut_signal = true;
      targetGrowth = Math.max(0, targetGrowth - 1);
    }

    // Chronic low fill overrides every upward signal: never grow a sector
    // that can't sell what it already makes.
    if (chronicLowFill) {
      constraintFlags.chronic_low_fill = true;
      targetGrowth = Math.min(targetGrowth, sp.sector.targetGrowthRate ?? 2, 1);
    }

    if (targetGrowth !== (sp.sector.targetGrowthRate ?? 2)) {
      sectorUpdates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { targetGrowthRate: targetGrowth, updatedAt: now } },
      });
    }
  }

  // ── 2b. Macro-aware production policy ─────────────────────────────────────
  // Ramp output of scarce/premium commodities. Glut response is growth-only
  // (section 2a) — see computeMacroProductionPolicy for why negative policy
  // is forbidden here. Trends 1pt/turn toward the target via the turn engine.
  for (const sp of sectorProfits) {
    if (divestedSectorIds.includes(sp.sector._id)) continue;
    if (sp.sector.mothballed === true) continue;
    const sectorCountryId = sp.sector.countryId ?? corp.countryId;
    let target = computeMacroProductionPolicy(sp.sector.sectorType, sectorCountryId, priceRatioOf);
    if (target == null) continue;
    // Fill-awareness (t899): under chronic low fill, cap the production policy
    // at 0 — a shortage price signal is no reason to ramp output this sector
    // demonstrably cannot sell.
    if (sp.sector.soldFraction != null && sp.sector.soldFraction < CHRONIC_LOW_FILL_THRESHOLD) {
      target = Math.min(target, 0);
    }
    if (target !== (sp.sector.productionPolicy ?? 0)) {
      sectorUpdates.push({
        filter: { _id: sp.sector._id },
        update: { $set: { productionPolicy: target, updatedAt: now } },
      });
    }
  }

  // ── 2c. Glut mothballing (plants only) ────────────────────────────────────
  // Sections 2a/2b only STOP a glutted sector from growing; nothing ever takes
  // existing capacity OFF the market. Under plants that matters: NPP plants
  // seeded at national-economy scale (100k-300k units/day) keep producing
  // full-tilt into markets clearing at soldFraction 0.01-0.08, pinning every
  // finished-good price to the log-curve floor and starving player plants of
  // fill (ticket #1027 — chemicals sat 72x oversupplied, advertising 125x).
  // Negative productionPolicy is the WRONG lever for this (its lean-ops
  // asymmetry cuts input demand harder than output and worsened gluts, GH
  // #3370); mothballing is the right one — a mothballed plant is cold on BOTH
  // sides, so a glutted market loses supply while the extraction inputs it was
  // hoarding (all in shortage, live fertilizers fill 0.1) are released.
  //
  // Deliberately gradual and self-limiting: a corp is only ELIGIBLE for a
  // state change on its stagger slot (see GLUT_STATE_CHANGE_STAGGER — young
  // worlds are wall-to-wall single-sector NPP corps, so per-corp limits alone
  // are cohort-wide cliffs), at most ONE change per corp per turn, and only
  // while the sector's own fill is under GLUT_MOTHBALL_FILL_THRESHOLD — as
  // capacity idles, surviving sellers' fill rises and the trigger stops
  // firing. A single-sector corp MAY go fully cold: the restart pass prices
  // its market without needing fill, so cold is recoverable, and exempting
  // last sectors would exempt essentially the whole glut. Restarts use the
  // price signal with a wide hysteresis band and are preferred over new
  // mothballs so a recovering market reactivates before it sheds more.
  // State-owned corps (countryOwnerId) are exempt: SOEs are policy
  // instruments, not margin-seekers.
  if (
    plants?.enabled &&
    !corp.countryOwnerId &&
    glutStaggerEligible(corp._id.toString(), ctx.turn)
  ) {
    let stateChangeBudget = 1;

    // Restart pass first: recovering markets reactivate before anything sheds.
    for (const sp of sectorProfits) {
      if (stateChangeBudget <= 0) break;
      if (sp.sector.mothballed !== true) continue;
      if (divestedSectorIds.includes(sp.sector._id)) continue;
      const ratio = sectorShortageScore(
        sp.sector.sectorType,
        sp.sector.countryId ?? corp.countryId,
        priceRatioOf
      );
      if (ratio >= GLUT_RESTART_PRICE_RATIO) {
        sectorUpdates.push({
          filter: { _id: sp.sector._id },
          // A revived plant re-earns chronic-cost status from zero instead
          // of mothballing again on its first losing turn (step 5).
          update: { $set: { mothballed: false, pnlLossTurns: 0, updatedAt: now } },
        });
        stateChangeBudget -= 1;
      }
    }

    if (stateChangeBudget > 0) {
      let worst: { sp: SectorProfitInfo; fill: number } | null = null;
      for (const sp of sectorProfits) {
        if (sp.sector.mothballed === true) continue;
        if (divestedSectorIds.includes(sp.sector._id)) continue;
        // Extraction is excluded: every extractable is shortage-side (its
        // fill is ~1 so the gate would never fire) and its output/rationing
        // legs live outside the clearing book this signal reads.
        if (sp.sector.sectorType === "extraction") continue;
        const fill = sp.sector.soldFraction;
        // soldFraction is only written under clearing mode; a sector that
        // has never cleared (mid-build, legacy) is not a candidate.
        if (fill == null || fill >= GLUT_MOTHBALL_FILL_THRESHOLD) continue;
        const ratio = sectorShortageScore(
          sp.sector.sectorType,
          sp.sector.countryId ?? corp.countryId,
          priceRatioOf
        );
        if (ratio > GLUT_MOTHBALL_PRICE_RATIO) continue;
        if (worst == null || fill < worst.fill) worst = { sp, fill };
      }
      if (worst) {
        sectorUpdates.push({
          filter: { _id: worst.sp.sector._id },
          update: { $set: { mothballed: true, updatedAt: now } },
        });
      } else {
        // Filled plants can still lose money. Mothball the longest-running loss;
        // this reversible action shares the budget and follows fill-based sheds.
        const coldest = chooseCostMothballSector(
          sectorProfits,
          divestedSectorIds,
          COST_MOTHBALL_LOSS_TURNS
        );
        if (coldest) {
          sectorUpdates.push({
            filter: { _id: coldest.sector._id },
            update: { $set: { mothballed: true, updatedAt: now } },
          });
        }
      }
    }
  }

  // Input-squeeze strategy shifts use the 2c cohort independently: a mothball and a strategy
  // shift never target the same sector (a shift candidate is running and
  // selling; a mothball candidate is unfilled), and only one shift per corp
  // per turn keeps the cohort gradual. SOEs are exempt for 2c's reason.
  if (!corp.countryOwnerId && glutStaggerEligible(corp._id.toString(), ctx.turn)) {
    const retool = chooseNppStrategyRetool({
      corp,
      sectors,
      divestedSectorIds,
      turn: ctx.turn,
      now,
      currentYear: ctx.currentYear ?? 0,
      techTreesEnabled: ctx.techTreesEnabled ?? false,
      plantsEnabled: plants?.enabled === true,
      priceRatioOf,
    });
    if (retool) {
      sectorUpdates.push({
        filter: { _id: retool.sectorId },
        update: { $set: retool.updates },
      });
    }
  }

  // ── 2d. Wage policy (labour wages+) ───────────────────────────────────────
  // Stepped toward shortage/glut targets one tick at a time; see nppWagePolicy.
  if (ctx.labourWagesEnabled) {
    pushNppWageUpdates({
      corp,
      sectorProfits,
      divestedSectorIds,
      priceRatioOf,
      now,
      sectorUpdates,
    });
  }

  // ── 3. Budget decisions (revenue-based, not cash-based) ───────────────────
  // Budgets scale on what the corp EARNS, not what it holds. `totalRevenue`/
  // `corpMargin`/`isProfitable` are the net-of-overhead figures computed above.

  // Base budget shares by margin band, then scaled by archetype (marketing/R&D).
  // Logistics is an operational lever, not a personality one, so it's unscaled.
  let marketingPct: number;
  let logisticsPct: number;
  let rdPct: number;
  const isCashCrisis = liquidCapital <= effectiveCashFloor;
  if (!isProfitable || totalRevenue === 0 || isCashCrisis) {
    // Cash distress overrides accounting profit for discretionary budgets.
    marketingPct = 0.005;
    logisticsPct = 0.003;
    rdPct = 0;
  } else if (corpMargin < 10) {
    // Thin margins: lean budgets, no R&D
    marketingPct = 0.015;
    logisticsPct = 0.01;
    rdPct = 0;
  } else if (corpMargin < 25) {
    // Healthy margins: moderate investment
    marketingPct = 0.03;
    logisticsPct = 0.02;
    rdPct = 0.01;
  } else {
    // Strong margins: aggressive investment to grow
    marketingPct = 0.05;
    logisticsPct = 0.03;
    rdPct = 0.02;
  }

  // Budget-leg flag (section 3), in the code's own branch order.
  if (isCashCrisis) constraintFlags.budget_cash_crisis = true;
  else if (!isProfitable || totalRevenue === 0) constraintFlags.budget_unprofitable = true;
  else if (corpMargin < 10) constraintFlags.budget_thin_margin = true;

  const marketingBudget = Math.round(
    totalRevenue * marketingPct * modifiers.marketingMult * levers.marketingMult
  );
  const logisticsBudget = Math.round(totalRevenue * logisticsPct);
  const rdBudget = Math.round(totalRevenue * rdPct * modifiers.rdMult * levers.rdMult);
  if (marketingBudget !== (corp.marketingBudget ?? 0)) updates.marketingBudget = marketingBudget;
  if (logisticsBudget !== (corp.logisticsBudget ?? 0)) updates.logisticsBudget = logisticsBudget;
  if (rdBudget !== (corp.rdBudget ?? 0)) updates.rdBudget = rdBudget;

  // ── 4. Dividend policy ────────────────────────────────────────────────────
  // Rate scales with margin — higher margin = higher payout. isProfitable/
  // corpMargin are net of overhead (see profitability-analysis block above) —
  // a corp whose marketing/logistics/R&D/CEO-salary spend is eating its
  // sector income no longer reads as dividend-eligible just because its
  // sectors look healthy in isolation.
  let targetDividendRate = 0;
  if (isProfitable && liquidCapital > effectiveCashFloor && corpMargin >= 15) {
    if (corpMargin >= 30) targetDividendRate = 8;
    else if (corpMargin >= 20) targetDividendRate = 5;
    else targetDividendRate = 3;
    // Archetype tilts payout vs. reinvestment, clamped to a sane ceiling.
    targetDividendRate = Math.min(
      MAX_DIVIDEND_RATE,
      Math.round(targetDividendRate * modifiers.dividendMult * levers.dividendMult)
    );
  }
  // Dividend-leg flag (section 4): why the payout was withheld.
  if (targetDividendRate === 0) {
    if (!isProfitable) constraintFlags.dividend_unprofitable = true;
    if (!(liquidCapital > effectiveCashFloor)) constraintFlags.dividend_cash_floor = true;
    if (corpMargin < 15) constraintFlags.dividend_margin_below_min = true;
  }
  if (targetDividendRate !== (corp.dividendRate ?? 0)) {
    updates.dividendRate = targetDividendRate;
  }

  if (passive) {
    updates.marketingBudget = 0;
    updates.logisticsBudget = 0;
    updates.rdBudget = 0;
    updates.dividendRate = 0;
    return {
      corpId: corp._id,
      updates,
      liquidCapitalDelta: 0,
      cashFloorLocal: effectiveCashFloor,
      sectorUpdates,
      strategy: strategyDecision?.state,
      operatorObservation: buildNppOperatorObservation({
        passive: true,
        profitable: isProfitable,
        marginPct: corpMargin,
        cashCrisis: isCashCrisis,
        entryReason: entryDiagnostic?.reason,
        dividendRate: 0,
        divestedSectors: divestedSectorIds.length,
        reinvestments: 0,
        cashHeadroomAnchor: cashToAnchor(cashLocal - effectiveCashFloor),
        constraintFlags,
      }),
    };
  }

  // ── 5. Sector expansion ───────────────────────────────────────────────────
  // Candidate search, ordinary entry gates, and the funnel diagnostic naming
  // the first binding gate. See evaluateNppEntry. The frontier fallback (5b)
  // overlays this evaluation; the shared priced founding block below prices
  // whichever target survives.
  const surplusCash = liquidCapital - effectiveCashFloor;
  const entry = evaluateNppEntry({
    corp,
    sectors,
    unownedByCountry,
    stateControlled,
    priceRatioOf,
    placementSignals,
    plantsEnabled: plants?.enabled === true,
    eraUnitScale: plants?.eraUnitScale ?? 1,
    profitable: isProfitable,
    marginPct: corpMargin,
    marginFloorPct: effectiveExpansionMinMargin,
    surplusCash,
    minCash: effectiveExpansionMinCash,
    sectorCount: effectiveSectors,
    logisticsSupportedSectors,
    allowExpansion: levers.allowExpansion,
    ordinaryEntryEligible: ctx.ordinaryEntryEligible,
    shortageEntryEligible: ctx.shortageEntryEligible,
    retailExpansionPaused: ctx.retailExpansionPaused,
    entryCapReached: newSectors.length >= NPP_SHORTAGE_ENTRIES_PER_TURN,
  });
  const {
    entryCandidate,
    expansion,
    hasLogisticsCapacity,
    marketEntryEligible,
    exceptionalShortageEntry,
    ordinaryEntryTargetGlutted,
    ordinaryEntry,
    foundingStrategyId,
  } = entry;
  entryDiagnostic = entry.diagnostic;
  // Whether the founding evaluation below runs at all. Captured so the
  // capacity observation can tell pre-evaluation gates (eligibility, demand)
  // from affordability gates; `newSectors` is still empty here, so the cap
  // term is trivially true and needs no gate of its own.
  // ── 5b. Frontier-entry experiment fallback (issue #991) ───────────────────
  // A policy-cleared candidate rejected only on an expectational gate gets
  // one priced evaluation through the shared founding block below. See
  // evaluateFrontierCandidate for the relaxable reasons, gate revalidation,
  // and slot checks.
  const frontier = evaluateFrontierCandidate({
    turnState: ctx.frontierEntry,
    corp,
    candidate: entryCandidate,
    diagnostic: entryDiagnostic,
    gates: {
      allowExpansion: levers.allowExpansion,
      hasLogisticsCapacity,
      marketEntryEligible,
      retailBlocked: ctx.retailExpansionPaused === true && entryCandidate?.sectorType === "retail",
      targetGlutted: ordinaryEntryTargetGlutted,
    },
  });
  // The ordinary target when the corp earned it, else the experiment's
  // second-chance target. `expansion` is the entry candidate itself whenever
  // it is non-null, so the block below prices the same slot either way.
  const foundingTarget = expansion ?? frontier?.target ?? null;
  const foundingBlockEntered =
    foundingTarget !== null &&
    newSectors.length < NPP_SHORTAGE_ENTRIES_PER_TURN &&
    (ordinaryEntry || exceptionalShortageEntry || frontier !== null);
  // Founding outcome tracked across the priced branches for the capacity
  // observation; see capacityDecisionTelemetry. Blank until a branch prices
  // the candidate: pre-pricing gates observe explicit zeros, never a
  // fabricated quote.
  const foundingOutcome = createFoundingCapacityOutcome();
  if (foundingBlockEntered) {
    if (plants?.enabled) {
      // NPPs and players found sectors on the same priced-capacity terms.
      const headroomUnits = unownedHeadroomUnitsOf(
        foundingTarget.sectorType as CorporationType,
        foundingTarget.headroomUnits,
        foundingTarget.revenue,
        plants.eraUnitScale
      );
      const starterUnits = foundingStarterUnits(foundingTarget.sectorType as CorporationType);
      // Per-unit founding price. computeBuildCost is linear in units and, at a
      // greenfield entry, the dominance multiplier is 1 (no presence yet), so a
      // one-unit quote scales exactly to any order size. The breakdown (not
      // just the total) is kept for the capacity observation's price vocabulary.
      const foundingUnitQuote =
        starterUnits > 0
          ? computeBuildCost({
              sectorType: foundingTarget.sectorType as CorporationType,
              units: 1,
              // Greenfield entry: the sector does not exist yet and is founded
              // on the sector-type default strategy.
              strategyId: null,
              year: plants.year,
              eraUnitScale: plants.eraUnitScale,
              // No presence in this bucket yet — dominance is 1 by construction.
              marketSharePercent: 0,
              primeRate: plants.primeRateOf(foundingTarget.countryId),
              // An NPP CEO is an NPP, not a Character, so it has no Business
              // Acumen to read. Neutral is the honest value and matches what
              // `computeBuildCost` assumes for a vacant seat.
              acumen: NEUTRAL_STAT,
              hostCostOfLivingIndex: plants.costOfLivingOf(foundingTarget.stateId),
              founding: true,
            })
          : null;
      const perUnitFoundingAnchor = foundingUnitQuote?.totalAnchor ?? 0;
      // Charged in the corp's own currency: fee + build are ₳, liquidCapital is not.
      const entryFeeAnchor = sectorEntryFeeAnchor(plants.preset);
      const entryCapital =
        liquidCapital + (exceptionalShortageEntry ? (ctx.shortageEntryCreditLocal ?? 0) : 0);
      // Size the first build to available capital, not a token facility. Deploy
      // a bounded fraction of post-floor, post-fee surplus into capacity, capped
      // by the market's unowned headroom and by the per-order ceiling, and
      // floored at the one-facility quantum so a cash-poor entry still behaves
      // as before. See NPP_FOUNDING_DEPLOY_FRACTION.
      const perUnitFoundingLocal = toCorpLocal(perUnitFoundingAnchor);
      const entryFeeLocal = toCorpLocal(entryFeeAnchor);
      const deployBudgetLocal = Math.max(
        0,
        (entryCapital - effectiveCashFloor - entryFeeLocal) * NPP_FOUNDING_DEPLOY_FRACTION
      );
      const affordableUnits =
        perUnitFoundingLocal > 0 ? Math.floor(deployBudgetLocal / perUnitFoundingLocal) : 0;
      const isExtraction = foundingTarget.sectorType === "extraction";
      // Extraction founds against a DEPOSIT, not local demand: its output is a
      // traded commodity sold wherever the commodity is short, so it has no
      // demand-headroom cap (headroomUnits is 0 for every extraction bucket by
      // construction). Cash and a per-mine facility ceiling bound it instead;
      // the state deposit haircut caps real output and the reinvestment growth
      // leg deepens it over turns. Demand-side sectors keep the headroom cap.
      const sizeCap = isExtraction
        ? starterUnits * NPP_EXTRACTION_FOUNDING_MAX_FACILITIES
        : headroomUnits * NPP_FOUNDING_HEADROOM_SHARE;
      const buildUnits =
        starterUnits > 0
          ? Math.max(
              starterUnits,
              Math.floor(Math.min(sizeCap, affordableUnits, MAX_BUILD_UNITS_PER_ORDER))
            )
          : 0;
      const buildAnchor = perUnitFoundingAnchor * buildUnits;
      const foundingCost = toCorpLocal(entryFeeAnchor + buildAnchor);
      entryDiagnostic = {
        ...entryDiagnostic,
        targetHeadroomUnits: headroomUnits,
        starterUnits: buildUnits,
        foundingCostLocal: foundingCost,
        entryCapitalLocal: entryCapital,
        cashFloorLocal: effectiveCashFloor,
      };

      // Affordability against the REAL cost. The generic surplus gate above is
      // a flat nominal band and cannot know what a build in this sector costs;
      // without this an NPP would commit to a plant it cannot pay for and drive
      // itself under the cash floor. Demand-side sectors also require the market
      // have room for the facility; extraction is deposit-gated (candidacy)
      // rather than headroom-gated, so it skips that check.
      // Named (not inlined) so the capacity observation below records the same
      // first-rejecting-gate outcome the branch takes.
      noteFoundingCapacityOutcome(foundingOutcome, {
        affordable:
          buildUnits > 0 &&
          (isExtraction || headroomUnits >= buildUnits) &&
          entryCapital - foundingCost >= effectiveCashFloor,
        creditPath:
          exceptionalShortageEntry &&
          starterUnits > 0 &&
          headroomUnits >= starterUnits &&
          !isStateOwned(corp) &&
          !corp.imfBailoutActive,
        sizeBlocked: starterUnits <= 0 || headroomUnits < starterUnits,
        quote: {
          unitPriceAnchor: perUnitFoundingAnchor,
          dominanceMultiplier: foundingUnitQuote?.dominanceMultiplier ?? 1,
          requestedUnits: buildUnits,
          cashHeadroomAnchor: cashToAnchor(entryCapital - foundingCost),
        },
      });
      if (foundingOutcome.affordable) {
        const buildTurns = Math.max(
          1,
          CAPACITY_BUILD_TURNS(foundingTarget.sectorType as CorporationType, true)
        );
        // Legacy nameplate: demand-side sectors take the built share of the
        // pool; extraction has no pool, so it prices the nameplate off the units
        // built (unit x revenue-per-unit), as the player founding path does.
        const nameplateShare = headroomUnits > 0 ? Math.min(1, buildUnits / headroomUnits) : 0;
        const nameplateAnchor = isExtraction
          ? buildUnits *
            revenuePerCapacityUnit(
              foundingTarget.sectorType as CorporationType,
              plants.eraUnitScale
            )
          : foundingTarget.revenue * nameplateShare;
        newSectors.push({
          stateId: foundingTarget.stateId,
          countryId: foundingTarget.countryId,
          sectorType: foundingTarget.sectorType,
          strategyId: foundingStrategyId,
          // Written in the corp's own currency, because that is what
          // `sectorTurn` reads it as (`readCorpEconomicAnchor` on the way in,
          // `writeCorpEconomicLocal` on the way out). The unowned pool is ₳,
          // so an unconverted copy made the sector's stored nameplate 1/fx of
          // the value the very next turn would restate it to — a one-turn ×fx
          // step change in every non-anchor currency.
          revenue: Math.round(toCorpLocal(nameplateAnchor)),
          profitMargin: 35,
          starterOrder: {
            unitsOrdered: buildUnits,
            // Greenfield: priced at the sector-type default, same as the quote.
            strategyId: null,
            costPaidAnchor: buildAnchor,
            startTurn: ctx.turn,
            onlineTurn: ctx.turn + buildTurns,
            smooth: true,
          },
        });
        unownedDraws.push({
          stateId: foundingTarget.stateId,
          sectorType: foundingTarget.sectorType as CorporationType,
          units: buildUnits,
          countryId: foundingTarget.countryId,
        });
        cashLocal = entryCapital - foundingCost;
        entryDiagnostic = setNppMarketEntryReason(entryDiagnostic, "entered");
      } else {
        if (foundingOutcome.creditPath) {
          shortageCreditRequest = {
            amountLocal: Math.max(0, foundingCost + effectiveCashFloor - entryCapital),
            sectorType: foundingTarget.sectorType as CorporationType,
          };
        }
        // Names the priced shortfall explicitly. Previously an
        // unaffordable candidate with no credit, size, or exceptional path
        // kept its pre-pricing reason (usually the cash floor), so the
        // funnel understated real founding-cost rejections.
        entryDiagnostic = setNppMarketEntryReason(
          entryDiagnostic,
          resolveFoundingShortfallReason({
            creditPath: foundingOutcome.creditPath,
            sizeBlocked: foundingOutcome.sizeBlocked,
            exceptionalShortageEntry,
          })
        );
      }
    } else {
      const foundingCost = toCorpLocal(EXPANSION_COST);
      const entryCapital =
        liquidCapital + (exceptionalShortageEntry ? (ctx.shortageEntryCreditLocal ?? 0) : 0);
      // Legacy (non-plants) founding has no per-unit quote; the observation
      // records the affordability facts with an explicit zero price.
      noteFoundingCapacityOutcome(foundingOutcome, {
        affordable: entryCapital - foundingCost >= effectiveCashFloor,
        creditPath: exceptionalShortageEntry && !isStateOwned(corp) && !corp.imfBailoutActive,
        sizeBlocked: false,
        quote: {
          unitPriceAnchor: 0,
          dominanceMultiplier: 1,
          requestedUnits: 0,
          cashHeadroomAnchor: cashToAnchor(entryCapital - foundingCost),
        },
      });
      if (foundingOutcome.affordable) {
        newSectors.push({
          stateId: foundingTarget.stateId,
          countryId: foundingTarget.countryId,
          sectorType: foundingTarget.sectorType,
          strategyId: foundingStrategyId,
          revenue: Math.round(foundingTarget.revenue * 0.25),
          profitMargin: 35,
        });
        cashLocal = entryCapital - foundingCost;
        entryDiagnostic = setNppMarketEntryReason(entryDiagnostic, "entered");
      } else {
        if (foundingOutcome.creditPath) {
          shortageCreditRequest = {
            amountLocal: Math.max(0, foundingCost + effectiveCashFloor - entryCapital),
            sectorType: foundingTarget.sectorType as CorporationType,
          };
        }
        entryDiagnostic = setNppMarketEntryReason(
          entryDiagnostic,
          resolveFoundingShortfallReason({
            creditPath: foundingOutcome.creditPath,
            sizeBlocked: foundingOutcome.sizeBlocked,
            exceptionalShortageEntry,
          })
        );
      }
    }
  }

  // Frontier experiment slot accounting: every placement consumes one
  // cohort and one controller slot; experiment placements carry the trial
  // marker. See settleFrontierEntryPlacement.
  entryDiagnostic = settleFrontierEntryPlacement({
    turnState: ctx.frontierEntry,
    frontier,
    diagnostic: entryDiagnostic,
    corp,
    fallbackCandidate: entryCandidate,
    ordinaryEntry,
    exceptionalShortageEntry,
  });

  // One founding observation per corp per turn; gate evaluation lives in
  // capacityDecisionTelemetry.
  pushFoundingCapacityObservation(capacityObservations, {
    cohort: capacityCohort,
    competitorCount: entryCandidate
      ? rivalCount(entryCandidate.stateId, entryCandidate.sectorType)
      : 0,
    outcome: foundingOutcome,
    fallbackCashHeadroomAnchor: cashToAnchor(cashLocal - effectiveCashFloor),
    gates: {
      allowExpansion: levers.allowExpansion,
      isProfitable,
      corpMargin,
      minMargin: effectiveExpansionMinMargin,
      entryCandidate: entryCandidate
        ? { stateId: entryCandidate.stateId, sectorType: entryCandidate.sectorType }
        : null,
      hasLogisticsCapacity,
      marketEntryEligible,
      shortageEntryEligible: ctx.shortageEntryEligible === true,
      retailExpansionPaused: ctx.retailExpansionPaused === true,
      ordinaryEntryTargetGlutted,
      exceptionalShortageEntry,
      blockEntered: foundingBlockEntered,
      plantsEnabled: plants?.enabled === true,
      expansionPresent: expansion !== null,
      surplusCash,
      minCash: effectiveExpansionMinCash,
    },
  });

  // ── 6. Capacity reinvestment (plants only) ────────────────────────────────
  //
  // The replacement for the growth-target decision the AI lost under plants.
  // See the NPP_REINVEST_* constants block for the rule, the arithmetic and the
  // calibration. Non-plants worlds skip this block entirely and are byte-
  // identical to before.
  //
  // STATE-OWNED ENTERPRISES ARE EXCLUDED. Everything below is PRIVATE-SECTOR
  // machinery: it rations the build against the corp's own liquid cash
  // (`effectiveCashFloor`, `NPP_REINVEST_MAINTENANCE_CASH_SHARE`) because a
  // private corp's capex is funded out of retained earnings. An SOE's is not —
  // a state enterprise funds capacity from state channels, and its treasury
  // backstop deliberately covers only its OPERATING loss (see
  // `coverableSoeShortfallAnchor`; covering build orders was the P3b exploit).
  // Running an SOE through this path therefore charges it cash the state never
  // gave it and leaves it permanently insolvent. Its channels are instead:
  //   • command economies — the Gosbank directed-credit tranche, floored at one
  //     turn of depreciation replacement (`commandEconomyTurn`);
  //   • every other state-owned corp — the budgeted state capex grant from the
  //     owning treasury (`processSoeOperations`).
  // Note this is the CANONICAL `isStateOwned` reader, not `ownershipState`
  // alone: the seeded NatCorps and the command-economy national enterprises
  // carry `countryOwnerId` and no `ownershipState`, so the old local check saw
  // them as private.
  if (plants?.enabled && !isStateOwned(corp)) {
    // Shared-snapshot pool lookup; see reinvestCandidatePool.
    const poolFor = createReinvestPoolLookup(unownedByCountry);

    const candidates: ReinvestCandidate[] = [];
    // `plants` narrowing does not persist into the pool callback below.
    const plantsEraUnitScale = plants.eraUnitScale;
    // Observation for one evaluated reinvestment candidate; see
    // capacityDecisionTelemetry. `readCashLocal` tracks the running balance so
    // unpriced gates observe headroom as current cash.
    const { observe: observeReinvestCandidate, observePriced: observePricedReinvestCandidate } =
      createReinvestCapacityObserver({
        cohort: capacityCohort,
        competitorCountOf: rivalCount,
        cashToAnchor,
        readCashLocal: () => cashLocal,
        poolHeadroomOf: (sector) =>
          reinvestPoolHeadroomUnits(poolFor, sector, corp.countryId, plantsEraUnitScale),
        push: (observation) => capacityObservations.push(observation),
      });

    for (const sp of sectorProfits) {
      const sector = sp.sector;
      // Nothing built yet (a newborn founding, or a pre-flip sector still
      // awaiting its transition order): there is no capacity to maintain and no
      // fill telemetry to justify a build.
      const capitalStock = sector.capitalStock ?? 0;
      // Queue-array ceiling — see the constant for why this is not the
      // rationing dial.
      const queueDepth = sector.buildQueue?.length ?? 0;
      // (a) Is it selling what it makes? Persisted units telemetry only — no
      // telemetry means no evidence, and no evidence means no build.
      const produced = sector.producedUnits ?? 0;
      const sold = sector.soldUnits ?? 0;
      const fill = produced > 0 ? sold / produced : 0;
      // (b) Is there room in the market to absorb more output? Same unowned
      // pool the founding path sizes and draws against.
      const sectorCountryId = sector.countryId ?? corp.countryId;
      // Pre-sizing gates in precedence order; the first rejection is observed
      // for the capacity funnel instead of silently skipped.
      const preSizingGate = evaluateReinvestPreSizingGate({
        divested: divestedSectorIds.includes(sector._id),
        mothballed: sector.mothballed === true,
        no_capacity: !(capitalStock > 0),
        queue_full: queueDepth >= NPP_REINVEST_MAX_QUEUE_DEPTH,
        no_telemetry: !(produced > 0),
        fill_below_min: produced > 0 && fill < NPP_REINVEST_MIN_FILL,
        state_controlled: stateControlled.has(bucketKey(sector.stateId, sector.sectorType)),
      });
      if (preSizingGate) {
        observeReinvestCandidate(preSizingGate, sector, capitalStock, null, 0, null);
        continue;
      }
      // ─── Headroom is a gate on GROWTH, never on REPLACEMENT ────────────────
      //
      // A bucket an incumbent already fills has ZERO unowned headroom by
      // construction, and nothing ever puts headroom back: depreciation
      // destroys owned capacity without returning it to the pool (see
      // `advanceCapitalStock` in sectorTurn — the stock shrinks, no pool write
      // follows). Gating the whole build on `headroomUnits > 0` therefore
      // blocked reinvestment in exactly the sectors that needed it, forever.
      //
      // Measured on the 96-turn A/B (`ab4_plants`, turn 135): 128 of 3,842 pool
      // rows sat at zero headroom, and those rows covered 391 of the 1,006
      // owned sectors — 237 of the 238 NPP sectors that passed every other gate
      // were refused here. That is the whole "zero builds in a 96-turn world".
      //
      // The split below is the accounting that makes both legs honest:
      //   • REPLACEMENT (δ) — buying back capacity that already existed in this
      //     market and wore out. World capacity is not increased, so it needs no
      //     headroom and draws nothing from the pool. It is the netted form of
      //     "depreciation frees headroom, the rebuild consumes it again".
      //   • GROWTH (g) — genuine new capacity. Headroom-gated, clamped to a
      //     quarter of the pool and drawn out of it, exactly as founding is.
      // It also matches the player path: `buildCapacity` (a top-up) is not
      // headroom-gated at all, while `expandSector` (an entry) draws the pool.
      const headroomUnits = reinvestPoolHeadroomUnits(
        poolFor,
        sector,
        corp.countryId,
        plants.eraUnitScale
      );

      // Sizing: replacement restores worn capacity; growth (below) is a
      // separate cash-and-demand decision that no longer reads targetGrowthRate.
      // fill = MIN_FILL ⇒ 0.5×, fill = 1 (sold out) ⇒ 1×. A sector that is only
      // just clearing its output gets a half-sized build, not zero: it still
      // has to replace what wore out.
      const fillScale =
        0.5 +
        0.5 *
          Math.min(1, Math.max(0, (fill - NPP_REINVEST_MIN_FILL) / (1 - NPP_REINVEST_MIN_FILL)));
      // Replacement is sized off the capacity the plant actually RUNS, not off
      // its nameplate. Under plants a sector's output is throughput- and
      // clearing-bound (measured median utilization 0.85 against 0.996 in the
      // capital arm), so the idle remainder is capacity the corp is already
      // paying IDLE_UPKEEP_FRACTION on for nothing — worth ~4.9 points of
      // margin at the A/B's median. Replacing the nameplate would buy that idle
      // share back every turn in perpetuity; replacing the RUN capacity lets it
      // depreciate away and the plant converges on the size it can actually
      // sell.
      const productionCapacity = sector.operatingCapacityUnits ?? capitalStock;
      const utilizationOfOwnedCapacity =
        productionCapacity > 0
          ? Math.max(0, Math.min(1, (sector.producedUnits ?? 0) / productionCapacity))
          : 0;
      const runUnits = capitalStock * utilizationOfOwnedCapacity;
      // ACCRUAL, not a per-turn slice. A build lands `CAPACITY_BUILD_TURNS`
      // turns after it is placed, and the queue ceiling can stop the corp
      // ordering for a stretch; sizing each order off the depreciation that has
      // accrued since the LAST order makes the capacity bought independent of
      // how often the corp got to order. Capped at one build cycle so a sector
      // that has never ordered (or whose queue just emptied after a long gap)
      // cannot place a giant catch-up build.
      const buildCycle = Math.max(1, CAPACITY_BUILD_TURNS(sector.sectorType));
      const lastOrderTurn = (sector.buildQueue ?? []).reduce(
        (latest, o) => (Number.isFinite(o.startTurn) ? Math.max(latest, o.startTurn) : latest),
        Number.NEGATIVE_INFINITY
      );
      const accrualTurns = Number.isFinite(lastOrderTurn)
        ? Math.min(buildCycle, Math.max(0, ctx.turn - lastOrderTurn))
        : 1;
      // Stranded-plant decay (supply-dislocation P1b): in a state whose own
      // market is deep-glut for this sector's outputs, replace only half of
      // what wears out. Full replacement held every misplaced plant at its
      // built size forever; half lets it shrink toward what its state can
      // absorb while a plant in a starved state replaces in full. Growth is
      // already state-tilted via targetGrowthRate (section 2a).
      const stateShortage = sectorShortageScore(
        sector.sectorType,
        sectorCountryId,
        (commodity, cid) =>
          placementSignals?.statePriceRatioOf?.(commodity, sector.stateId) ??
          priceRatioOf(commodity, cid)
      );
      const peakStateShortage = sectorPeakShortageScore(
        sector.sectorType,
        sectorCountryId,
        (commodity, cid) =>
          placementSignals?.statePriceRatioOf?.(commodity, sector.stateId) ??
          priceRatioOf(commodity, cid)
      );
      const criticalShortage = peakStateShortage >= ESSENTIAL_SHORTAGE_SCORE;
      const interventionPriority = fragileReinvestmentPriority(
        sector,
        sectorCountryId,
        placementSignals,
        priceRatioOf,
        ctx.turn
      );
      const strandedDecayScale = stateShortage <= 0.85 ? 0.5 : 1;
      const accruedReplacementUnits =
        runUnits *
        CAPITAL_DEPRECIATION_PER_TURN *
        accrualTurns *
        fillScale *
        strandedDecayScale *
        NPP_REINVEST_AGGRESSION;
      // Two pending builds already cover this plant's current investment
      // cadence. Do not fill the larger storage-only queue with a tiny
      // replacement order every turn: those orders occupied all 20 slots in
      // chronic shortages and prevented the meaningful growth leg from ever
      // reopening. Replacement accrual catches up when a slot lands.
      const replacementUnits =
        queueDepth >= NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH ? 0 : accruedReplacementUnits;
      // GROWTH — build from nothing, sized by cash and demand, exactly as a
      // player tops up a plant with `buildCapacity`. Demand-side sectors do not
      // use the unowned pool as a hard cap: their proven sell-through is the
      // demand signal and the affordability rail limits the order. Extraction
      // is different. Its physical market is the state's finite deposit, so the
      // deposit headroom signal gates and scales new growth. Without that second
      // gate a rare-earth price spike could make a mine keep adding capacity
      // after the state's geology was already exhausted; production was capped,
      // but the balance sheet and national sector mix kept inflating.
      const facilityUnits = foundingStarterUnits(sector.sectorType);
      const utilization = capitalStock > 0 ? runUnits / capitalStock : 0;
      const extractionHeadroom =
        sector.sectorType === "extraction"
          ? Math.max(0, Math.min(1, placementSignals?.extractionHeadroomOf?.(sector.stateId) ?? 1))
          : 1;
      const canGrow =
        (sp.isProfitable || criticalShortage) &&
        levers.allowGrowthCapex &&
        !(ctx.retailExpansionPaused && sector.sectorType === "retail") &&
        queueDepth < NPP_REINVEST_MAX_GROWTH_QUEUE_DEPTH &&
        stateShortage > NPP_GROWTH_MIN_SHORTAGE &&
        utilization >= NPP_GROWTH_MIN_UTILIZATION &&
        (sector.sectorType !== "extraction" || extractionHeadroom > 0);
      // The plant already exists, so its build is tolled at its own dominance
      // and pays the list price, not the founding discount — the same terms a
      // player's `buildCapacity` pays.
      const growthShare =
        capitalStock > 0
          ? Math.min(100, (100 * capitalStock) / (capitalStock + Math.max(0, headroomUnits)))
          : 0;
      const perUnitGrowthLocal = canGrow
        ? toCorpLocal(
            computeBuildCost({
              sectorType: sector.sectorType,
              units: 1,
              strategyId: sector.strategyId ?? null,
              year: plants.year,
              eraUnitScale: plants.eraUnitScale,
              marketSharePercent: growthShare,
              primeRate: plants.primeRateOf(sectorCountryId),
              acumen: NEUTRAL_STAT,
              hostCostOfLivingIndex: plants.costOfLivingOf(sector.stateId),
              founding: false,
            }).totalAnchor
          )
        : 0;
      const growthBudgetLocal =
        Math.max(0, cashLocal - effectiveCashFloor) * NPP_GROWTH_DEPLOY_FRACTION;
      // Demand anchor: grow by at most this share of proven throughput a turn
      // (at least one facility for demand-side sectors), not the whole treasury
      // at once. Extraction growth is additionally scaled by finite deposit
      // headroom and never floors up to a facility when the deposit cannot
      // support one.
      const growthCapUnits =
        sector.sectorType === "extraction"
          ? Math.floor(runUnits * NPP_GROWTH_MAX_STEP_OF_RUN * extractionHeadroom)
          : Math.max(facilityUnits, Math.floor(runUnits * NPP_GROWTH_MAX_STEP_OF_RUN));
      // Units the growth budget affords, bounded by that step. Growth only fires
      // if it clears one whole facility — below that the plant just replaces
      // depreciation, so a cash-poor corp keeps its maintenance rather than
      // bundling an unaffordable growth leg that would sink the whole order past
      // the entry floor.
      const affordableGrowthUnits =
        canGrow && perUnitGrowthLocal > 0
          ? Math.floor(
              Math.min(
                growthBudgetLocal / perUnitGrowthLocal,
                growthCapUnits,
                MAX_BUILD_UNITS_PER_ORDER
              )
            )
          : 0;
      const growthUnits =
        affordableGrowthUnits >= facilityUnits && growthCapUnits >= facilityUnits
          ? affordableGrowthUnits
          : 0;
      const units = replacementUnits + growthUnits;
      if (!(units > 0)) {
        observeReinvestCandidate(
          "below_minimum_order",
          sector,
          capitalStock,
          headroomUnits,
          units,
          null
        );
        continue;
      }

      candidates.push({
        sector,
        units,
        growthUnits,
        fill,
        headroomUnits,
        interventionPriority,
      });
    }

    // The governed treatment first reallocates the existing build slot to a
    // critically short fragile market. Normal ranking then uses sell-through
    // and headroom, including the build size so replacement candidates differ.
    candidates.sort(
      (a, b) =>
        Number(b.interventionPriority > 0) - Number(a.interventionPriority > 0) ||
        b.interventionPriority - a.interventionPriority ||
        b.fill * (b.headroomUnits + b.units) - a.fill * (a.headroomUnits + a.units)
    );

    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= NPP_REINVEST_MAX_SECTORS_PER_TURN) break;
      const { sector, units } = candidate;

      // Dominance is priced off the corp's own footprint in this bucket: its
      // capacity against that plus the headroom still unowned. A dominant
      // incumbent pays more to add capacity, exactly as a player does.
      const capitalStock = sector.capitalStock ?? 0;
      const bucketTotal = capitalStock + candidate.headroomUnits;
      const marketSharePercent = bucketTotal > 0 ? (100 * capitalStock) / bucketTotal : 0;

      // Breakdown (not just the total) is kept for the capacity observation's
      // price vocabulary: unit price, charged dominance multiplier, headroom.
      const reinvestPrice = computeBuildCost({
        sectorType: sector.sectorType,
        units,
        strategyId: sector.strategyId ?? null,
        year: plants.year,
        eraUnitScale: plants.eraUnitScale,
        marketSharePercent,
        primeRate: plants.primeRateOf(sector.countryId ?? corp.countryId),
        // An NPP CEO is an NPP, not a Character — no Business Acumen to read.
        acumen: NEUTRAL_STAT,
        hostCostOfLivingIndex: plants.costOfLivingOf(sector.stateId),
        // NOT a founding build: this plant already exists, so the founding
        // discount does not apply. An NPP topping up capacity pays the same
        // list price a player pays through `buildCapacity`.
        founding: false,
      });
      const costAnchor = reinvestPrice.totalAnchor;
      const costLocal = toCorpLocal(costAnchor);

      // Affordability. Nobody builds free — this is also the SOE capex
      // discipline: a state enterprise pays cash for its builds like anyone
      // else, and the CIP it creates is what the remittance pass amortizes
      // (CAPEX_AMORTIZATION_PER_TURN) instead of being swept to the treasury.
      //
      // Two rails, because the two legs are different decisions. A build with a
      // GROWTH leg is a discretionary bet and faces the same entry floor the
      // founding path uses. A REPLACEMENT-ONLY build is maintenance, and is
      // rationed as a share of cash instead — see
      // NPP_REINVEST_MAINTENANCE_CASH_SHARE for why the entry floor applied to
      // maintenance is a death spiral rather than prudence.
      // A zero or negative charge is not a buildable quote: observe it as a
      // sizing rejection, the same outcome as sizing to non-positive units.
      if (!(costLocal > 0)) {
        observeReinvestCandidate(
          "below_minimum_order",
          sector,
          capitalStock,
          candidate.headroomUnits,
          units,
          null
        );
        continue;
      }
      const affordable =
        candidate.growthUnits > 0
          ? cashLocal - costLocal >= effectiveCashFloor
          : costLocal <= Math.max(0, cashLocal) * NPP_REINVEST_MAINTENANCE_CASH_SHARE &&
            cashLocal - costLocal > 0;
      if (!affordable) {
        observePricedReinvestCandidate(
          "insufficient_cash",
          sector,
          capitalStock,
          candidate.headroomUnits,
          units,
          costAnchor,
          reinvestPrice.dominanceMultiplier,
          cashToAnchor(cashLocal - costLocal)
        );
        continue;
      }

      const buildTurns = Math.max(1, CAPACITY_BUILD_TURNS(sector.sectorType));
      const order: SectorBuildOrder = {
        unitsOrdered: units,
        strategyId: sector.strategyId ?? null,
        costPaidAnchor: costAnchor,
        startTurn: ctx.turn,
        onlineTurn: ctx.turn + buildTurns,
        smooth: true,
      };
      // ─── The queue write is a DELTA, never a whole-array `$set` ───────────
      //
      // `sector.buildQueue` is a snapshot read at the top of this turn phase.
      // A `$set` of the recomputed array would land AFTER `sectorTurn`'s own
      // `$pull` of the orders that completed this turn (bulkWrite is ordered,
      // and the NPP ops are appended last), resurrecting every landed order —
      // the capacity would be delivered again on the next tick. It would also
      // erase any order a player CEO placed during the phase. `$push` + `$inc`
      // touch only what this decision actually owns, and compose with both.
      // Same rule, same reason as `sectorTurn`'s C4 note.
      sectorUpdates.push({
        filter: { _id: sector._id },
        update: {
          $set: { updatedAt: now },
          $push: { buildQueue: order },
          $inc: { constructionInProgressAnchor: Math.round(costAnchor) },
        },
      });
      // Growth builds from nothing — a plant top-up does not draw the unowned
      // pool, exactly as a player's `buildCapacity` does not. The pool is not a
      // finite budget builds are rationed against; capacity is created by paying
      // for it. (Market share stays well-defined: owned capacity rises, so the
      // owner's share of owned+headroom rises, without touching the pool.)
      cashLocal -= costLocal;
      reinvestments.push({
        sectorId: sector._id,
        sectorType: sector.sectorType,
        units,
        costAnchor,
        costLocal,
        onlineTurn: order.onlineTurn,
      });
      // Observed after the spend: headroom is cash after the charged cost,
      // the same post-cost headroom the player path records.
      observePricedReinvestCandidate(
        "placed",
        sector,
        capitalStock,
        candidate.headroomUnits,
        units,
        costAnchor,
        reinvestPrice.dominanceMultiplier,
        cashToAnchor(cashLocal)
      );
      placed += 1;
    }
  }

  // Expansion and shareholder returns can coexist. The build paths above have
  // already paid capex and preserved the effective cash floor; forcing the
  // dividend rate to zero here made continuously-growing NPP corporations
  // retain every future profitable turn as well. The margin-based rate from
  // section 4 applies only to positive after-tax income at settlement time, so
  // it cannot spend the operating reserve or distribute a loss.

  return {
    corpId: corp._id,
    updates,
    // Ticket #1260: the cash leg travels as a DELTA, never as an absolute write.
    // These ops are appended to the corporation bulkWrite AFTER this turn's
    // income `$inc`, so a `$set` of the balance overwrote the credit and the
    // whole turn's operating income vanished. `cashLocal` starts at the opening
    // `liquidCapital` and every path above adjusts it — a market-entry credit
    // up, a founding cost or growth capex down — so this one subtraction is the
    // net movement whichever path ran. See `nppCashWrite.ts`.
    liquidCapitalDelta: cashLocal - liquidCapital,
    cashFloorLocal: effectiveCashFloor,
    sectorUpdates,
    newSectors: newSectors.length > 0 ? newSectors : undefined,
    divestedSectorIds: divestedSectorIds.length > 0 ? divestedSectorIds : undefined,
    unownedDraws: unownedDraws.length > 0 ? unownedDraws : undefined,
    reinvestments: reinvestments.length > 0 ? reinvestments : undefined,
    shortageCreditRequest,
    entryDiagnostic,
    strategy: strategyDecision?.state,
    capacityObservations,
    operatorObservation: buildNppOperatorObservation({
      passive: false,
      profitable: isProfitable,
      marginPct: corpMargin,
      cashCrisis: isCashCrisis,
      entryReason: entryDiagnostic?.reason,
      dividendRate: targetDividendRate,
      divestedSectors: divestedSectorIds.length,
      reinvestments: reinvestments.length,
      cashHeadroomAnchor: cashToAnchor(cashLocal - effectiveCashFloor),
      constraintFlags,
    }),
  };
}
