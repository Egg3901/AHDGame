/**
 * NPP corporation decisions use shared market and funding observations.
 * processNppCorporationDecisions loads them and prepares corporation and sector writes.
 */
import { makeNppCorpDecision } from "@/lib/turn/npp/corporationDecision";
export { makeNppCorpDecision } from "@/lib/turn/npp/corporationDecision";
import {
  buildNppDecisionCashWrites,
  type NppFoundingCashWitness,
} from "@/lib/turn/npp/foundingCashLedger";
import type { Db, ObjectId } from "mongodb";
import type { Corporation, CorporateSector, GameState, ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { currencyForCountry } from "@/lib/currency/sectorFxSpread";
import { netPerTurnDebtServiceAnchor } from "@/lib/bonds/corpBondCashflows";
import { buildActiveMarketBuckets, markMarketsActive } from "@/lib/turn/npp/marketSignals";

export {
  sectorShortageScore,
  computeMacroProductionPolicy,
  type CommodityPriceRatioFn,
} from "@/lib/turn/npp/marketSignals";

import { glutStaggerEligible } from "@/lib/turn/npp/cohort";

export { GLUT_STATE_CHANGE_STAGGER, glutStaggerEligible } from "@/lib/turn/npp/cohort";
export {
  STRATEGY_SHIFT_MARGIN_TRIGGER,
  STRATEGY_SHIFT_MIN_ADVANTAGE,
  STRATEGY_SHIFT_PROFIT_SEEK_ADVANTAGE,
  strategyPriceScore,
} from "@/lib/turn/npp/strategyRetooling";
import type { NPP } from "@/lib/db/types/npp";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import { ceoArchetypeModifiers } from "@/lib/turn/ceoArchetype";
import {
  buildNppCorporationDecisionIndexes,
  indexOpenUnownedSectors,
  nppDecisionCohortIds,
} from "@/lib/turn/npp/decisionSnapshotIndexes";

import { partitionOpenMarkets } from "@/lib/economy/queries/privateEnterpriseGate";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { ManufacturingProductProject } from "@/lib/products/manufacturingProject";

import { labourAtLeast, isLabourSystemMode } from "@/lib/labour/modes";

import {
  computeStateControlledBuckets,
  loadNationalCorpIds,
} from "@/lib/nationalization/stateControlledBuckets";

import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

import type { BuildCapexTxInput } from "@/lib/corporations/capexTxLog";

import { buildNppNationalShareResolver } from "@/lib/turn/npp/nationalDominancePricing";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { buildNppPriceSignals } from "@/lib/turn/npp/priceSignals";
import type { RelocationPrimeBank } from "@/lib/corporations/issueRelocationBond";
import { loadNppBankRateSnapshot } from "@/lib/turn/npp/bankRateSnapshot";
import {
  buildNppProductProjectsV2,
  loadNppCostOfLivingByState,
  loadNppProductProjectsV2,
} from "@/lib/turn/npp/manufacturingProducts";

import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import type { CapacityDecisionObservation } from "@/lib/corporations/capacityDecisionTelemetry/rules";
import { type NppOperatorObservation } from "@/lib/corporations/nppOperatorTelemetry/rules";
import {
  buildCapacityCompetitorIndex,
  makeCapacityCompetitorCounter,
  mergeCapacityObservations,
} from "@/lib/turn/npp/capacityDecisionTelemetry";

import type { NppCorpUpdateOp } from "./npp/nppCashWrite";
import type { NppReinvestmentCashWitness } from "./npp/reinvestmentCashLedger";

import {
  drawFoundedCapacityFromPools,
  flushNppCapacityWriteback,
} from "@/lib/turn/npp/capacityWriteback";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

import { loadNppBehaviorConfig } from "@/lib/turn/npp/behaviorConfig";
import {
  boundNppConstructionFinanceCandidates,
  loadNppConstructionFundingPool,
  NPP_CONSTRUCTION_FINANCE_TERM_TURNS,
  selectNppConstructionFundingContext,
  type NppConstructionFinanceCandidate,
  type NppConstructionFinanceRequest,
} from "@/lib/turn/npp/nppConstructionFinance";
import { maybePushNppTechUnlock } from "@/lib/turn/npp/corpBehaviorConfig";
import { corpDailyGrossRevenueLocalFromSectors } from "@/lib/corporations/dailyGrossRevenue";
import type { TechUnlockLedgerInput } from "@/lib/corporations/techTree/techUnlockLedger";
import { loadNppPlacementSignals } from "@/lib/turn/npp/fragileMarketSupply";
import {
  resolveNppMarketEntryCredit,
  type NppMarketEntryDiagnostic,
} from "@/lib/turn/npp/entryDiagnostics";

import { createFrontierEntryTurnState } from "@/lib/turn/npp/frontierEntryCandidate";
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
  NPP_GROWTH_MIN_SHORTAGE,
  NPP_GROWTH_MIN_UTILIZATION,
  NPP_GROWTH_MAX_STEP_OF_RUN,
  NPP_SHORTAGE_ENTRIES_PER_TURN,
  NPP_FOUNDING_DEPLOY_FRACTION,
  NPP_FOUNDING_HEADROOM_SHARE,
  DEFAULT_ARCHETYPE,
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
  corpUpdates: NppCorpUpdateOp[];
  sectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }>;
  newSectors: Array<Omit<CorporateSector, "_id"> & { _id: ObjectId }>;
  divestedSectorIds: ObjectId[];
  techLedger: TechUnlockLedgerInput[];
  foundingCashWitnesses?: NppFoundingCashWitness[];
  reinvestmentCashWitnesses?: NppReinvestmentCashWitness[];
  manufacturingProductProjects: ManufacturingProductProject[];
  constructionFinanceRequests: NppConstructionFinanceRequest[];
  constructionFinanceCandidateCount: number;
  constructionFinanceBacklogCount: number;
}> {
  const nppCorps = preloaded
    ? preloaded.corporations.filter((corp) => corp.ceoType === "npp" && corp.suspended !== true)
    : await db
        .collection<Corporation>("corporations")
        .find({ ceoType: "npp", suspended: { $ne: true } })
        .toArray();

  const corpUpdates: NppCorpUpdateOp[] = [];
  const allSectorUpdates: Array<{
    filter: { _id: ObjectId };
    update: NppSectorUpdateDoc;
  }> = [];
  const newSectors: Array<Omit<CorporateSector, "_id"> & { _id: ObjectId }> = [];
  const allDivestedSectorIds: ObjectId[] = [];
  const techLedger: TechUnlockLedgerInput[] = [];
  const foundingCashWitnesses: NppFoundingCashWitness[] = [];
  const decisionCashOps: NppCorpUpdateOp[] = [];
  const operatorObservations: NppOperatorObservation[] = [];

  if (nppCorps.length === 0)
    return {
      corpUpdates,
      sectorUpdates: allSectorUpdates,
      newSectors,
      divestedSectorIds: allDivestedSectorIds,
      techLedger,
      manufacturingProductProjects: [],
      constructionFinanceRequests: [],
      constructionFinanceCandidateCount: 0,
      constructionFinanceBacklogCount: 0,
    };

  const { corporationIds: corpIds, ceoNppIds } = nppDecisionCohortIds(nppCorps);
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
  const { archetypeByNppId, sectorsByCorp, priceByCommodity } = buildNppCorporationDecisionIndexes(
    ceoNpps,
    allSectors,
    commodityPriceDocs
  );
  const { priceRatioOf, statePriceRatioOf, stateDemandOf } = buildNppPriceSignals(priceByCommodity);

  const placementSignals = await loadNppPlacementSignals(db, turn, allSectors, statePriceRatioOf);
  placementSignals.stateDemandOf = stateDemandOf;

  const { open: openUnowned, blocked } = await partitionOpenMarkets(db, unownedSectors);

  const { unownedByCountry, unownedIndex } = indexOpenUnownedSectors(openUnowned);

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
  placementSignals.activeMarketBuckets = buildActiveMarketBuckets(globalSectors);

  // Rival index for capacity-decision telemetry, off the already-loaded
  // `globalSectors` snapshot: no turn-path reads. See capacityDecisionTelemetry.
  const competitorsByBucket = buildCapacityCompetitorIndex(globalSectors);

  const manufacturingProductProjectState = await loadNppProductProjectsV2(db, nppCorps);
  const plantsEnabled = manufacturingProductProjectState.plantsEnabled;
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

  const manufacturingProductProjects = buildNppProductProjectsV2({
    state: manufacturingProductProjectState,
    nppCorporations: nppCorps,
    sectorsByCorp,
    turn,
    techCurrentYear,
    techTreesEnabled,
    plants,
    priceRatioOf,
  });

  // Local-per-₳ rates for every live currency, loaded once. NPP money constants
  // are all ₳; `liquidCapital` is not. See `NppCorpDecisionContext.fxRate`.
  const fxByCurrency = new Map<string, number>();
  for (const rate of await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()) {
    if (rate.currencyCode && typeof rate.rate === "number" && rate.rate > 0) {
      fxByCurrency.set(rate.currencyCode, rate.rate);
    }
  }
  const { labourMode, retailExpansionPaused, ledgerShadow, bankingPolicy } =
    await loadNppBehaviorConfig(db, turn);
  const nppConstructionFinanceEnabled =
    plants?.enabled === true &&
    bankingPolicy.privateBanking &&
    bankingPolicy.treasuryCashLedger &&
    bankingPolicy.constructionFinance;
  const constructionFundingPool = nppConstructionFinanceEnabled
    ? await loadNppConstructionFundingPool({
        db,
        turn,
        corporations: nppCorps,
        policy: bankingPolicy,
        eraUnitScale: plants?.eraUnitScale ?? 1,
        fxByCurrency: fxByCurrency as ReadonlyMap<CurrencyCode, number>,
      })
    : null;
  const constructionFinanceCandidates: NppConstructionFinanceCandidate[] = [];

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
    if (nppConstructionFinanceEnabled && corpCurrency) {
      for (const intent of decision.constructionFinanceIntents ?? []) {
        constructionFinanceCandidates.push({
          ...intent,
          corporation: corp,
          currency: corpCurrency,
          buildContext: {
            destinationCurrency: currencyForCountry(intent.sector.countryId ?? corp.countryId),
            bucket: {
              stateId: intent.sector.stateId,
              countryId: intent.sector.countryId ?? corp.countryId,
              sectorType: intent.sector.sectorType,
              industryModel: intent.sector.industryModel ?? null,
              mediaDiscriminator: intent.sector.mediaDiscriminator ?? null,
            },
            eraUnitScale: plants?.eraUnitScale ?? 1,
            growthUnits: intent.growthUnits,
          },
        });
      }
    }
    markMarketsActive(placementSignals, decision.newSectors);
    if (decision.entryDiagnostic) entryDiagnostics.push(decision.entryDiagnostic);
    // Cohort telemetry aggregate (credit-rewrite included); see capacityDecisionTelemetry.
    mergeCapacityObservations(
      capacityObservations,
      decision.capacityObservations,
      decision.entryDiagnostic?.reason
    );
    if (decision.operatorObservation) operatorObservations.push(decision.operatorObservation);
    const {
      founded,
      update: corpUpdateOp,
      witness,
    } = buildNppDecisionCashWrites({
      decision,
      corporation: corp,
      capexRows,
      unownedDraws,
      unownedIndex,
      eraUnitScale: plants?.eraUnitScale ?? 1,
      currencyCode: corpCurrency,
      rate: corpFxRate,
      shadowEnabled: ledgerShadow,
      blocked,
      turn,
      now,
    });
    if (corpUpdateOp) {
      corpUpdates.push(corpUpdateOp);
      decisionCashOps.push(corpUpdateOp);
    }
    if (witness) foundingCashWitnesses.push(witness);

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

    newSectors.push(...founded);

    if (decision.divestedSectorIds) {
      allDivestedSectorIds.push(...decision.divestedSectorIds);
    }
  }

  const boundedConstructionFinance = nppConstructionFinanceEnabled
    ? boundNppConstructionFinanceCandidates(constructionFinanceCandidates)
    : { selected: [] as NppConstructionFinanceCandidate[], backlogCount: 0 };
  const constructionFinanceRequests: NppConstructionFinanceRequest[] = [];
  let constructionFinanceBacklogCount =
    boundedConstructionFinance.backlogCount +
    (nppConstructionFinanceEnabled && !constructionFundingPool
      ? boundedConstructionFinance.selected.length
      : 0);
  if (constructionFundingPool) {
    for (const candidate of boundedConstructionFinance.selected) {
      const selected = selectNppConstructionFundingContext(constructionFundingPool, candidate);
      if (!selected) {
        constructionFinanceBacklogCount += 1;
        continue;
      }
      constructionFinanceRequests.push({
        ...candidate,
        bankId: selected.bankId,
        principal: selected.principal,
        termTurns: NPP_CONSTRUCTION_FINANCE_TERM_TURNS,
        preloadedFundingContext: selected.context,
      });
    }
  }

  await drawFoundedCapacityFromPools(db, unownedDraws, {
    eraUnitScale: plants?.eraUnitScale ?? 1,
    now,
  });
  const reinvestmentCashWitnesses = await flushNppCapacityWriteback(db, {
    turn,
    now,
    entryDiagnostics,
    capexRows,
    cashOperations: decisionCashOps,
    shadowEnabled: ledgerShadow,
    capacityObservations,
    operatorObservations,
  });

  return {
    corpUpdates,
    sectorUpdates: allSectorUpdates,
    newSectors,
    divestedSectorIds: allDivestedSectorIds,
    techLedger,
    manufacturingProductProjects,
    constructionFinanceRequests,
    constructionFinanceCandidateCount: constructionFinanceCandidates.length,
    constructionFinanceBacklogCount,
    ...(foundingCashWitnesses.length ? { foundingCashWitnesses } : {}),
    ...(reinvestmentCashWitnesses.length ? { reinvestmentCashWitnesses } : {}),
  };
}
