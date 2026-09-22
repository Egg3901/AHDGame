/**
 * How commodity prices move each turn. processCommodityPriceTurn sums supply and
 * demand from owned sectors, prices each commodity as 50% global + 25% national +
 * 25% state, scales retail demand by GDP growth, and books extraction depletion
 * from realized output (realizedOutputFraction). A naval blockade closes a
 * country's seaborne trade lanes for the turn (loadBlockadeClosure, built on
 * blockadeClosureByCountry).
 *
 * Orchestration only: every DB read/write stays here, in the original order,
 * so the turn's query count and positional fetch sequence are unchanged. The
 * phase logic lives beside it in ./commodity/ — sectorLedger (supply-ledger
 * inputs), demandLegs (advertising, demographics, household, financial, rate,
 * government, calibration), pricing (national/reachable/state blend +
 * persistence payloads), tradeContext, sourcingSettlement (freight),
 * persistence (history, flows, trade snapshot), blockadeClosure, and
 * extractionDepletion.
 */
import { getDb } from "@/lib/mongodb";
import type {
  CorporateSector,
  CommodityPrice,
  StateMetrics,
  Corporation,
  CentralBank,
  Bond,
  FederalBudget,
  ExchangeRate,
  StateBudget,
  GameConfig,
} from "@/lib/db/types";
import {
  COUNTRY_CURRENCY_MAP,
  INITIAL_RATES,
  eraRateForCurrency,
  getInitialRates,
} from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  COMMODITY_TYPES,
  eraScaledBasePrices,
  computeRawSupplyDemand,
  type CommodityType,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import { retailLegacyDemandFactor } from "@/lib/market/retailDemandTransition";
import {
  loadActiveSectorDemandModifierPctMap,
  loadActiveSectorOutputDemandModifierPctMap,
} from "@/lib/events/worldEvents/sectorDemandModifierMap";
import {
  getMarketSystemMode,
  marketAtLeast,
  getExtractionOutputScaleEnabled,
  getDemographicsDemandEnabled,
  getHouseholdConsumptionEnabled,
} from "@/lib/market/featureFlag";
import { PLANTS_HOUSEHOLD_UNIT_SCALE } from "@/lib/turn/householdConsumption";
import { computeExtractionCapacityMultipliers } from "@/lib/turn/extraction/extractionCapacity";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import {
  getExtractionContractsCollection,
  activeExtractionContractFilter,
} from "@/lib/db/collections/extractionContracts";
import type { State } from "@/lib/db/types/state";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types/gameState";
import { clearAllCommodities } from "@/lib/trade/snapshot";
import { buildReachableBooks } from "@/lib/trade/reachableBook";
import { applyTradeConvergence } from "@/lib/trade/convergence";
import { buildTradeAffinity } from "@/lib/trade/tradeAffinity";
import { TRADE_PRICE_CONVERGENCE_K } from "@/lib/trade/constants";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import { reconcileSignedEmbargoBills } from "@/lib/trade/reconcileEmbargoes";
import type { Tariff } from "@/lib/db/types/tariff";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import { applySphereRoutedMacroContributions } from "@/lib/world/spheres";
import { depletedCapacityDoc } from "@/lib/extraction/depletion";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { resolveCommodityNominalIndices } from "@/lib/market/commodityNominalIndex";
import { persistCommodityNominalIndex } from "@/lib/turn/commodityNominalIndexPersistence";
export { realizedOutputFraction } from "@/lib/extraction/realizedOutputFraction";
import {
  buildStateLookups,
  buildSectorRows,
  buildGdpGrowthData,
  buildPrimeRateByState,
  buildExtractionRevenueInputs,
  accumulatePlantsUnits,
} from "./commodity/sectorLedger";
import {
  applyAdvertisingDemand,
  applyDemographicsUplift,
  applyHouseholdDemand,
  applyLatentFinancialDemand,
  applyRateSensitiveDemand,
  aggregateByCountry,
  applyGovernmentDemand,
  applyDemandCalibration,
  buildStatesByCountry,
  collectHouseholdSignals,
} from "./commodity/demandLegs";
import {
  buildNudgeMap,
  buildLaggedRatios,
  priceCommodity,
  type CommodityPricingContext,
} from "./commodity/pricing";
import { buildBlocsByCountry, buildCurtainedCountries } from "./commodity/tradeContext";
import { runFreightSettlementPhase } from "./commodity/sourcingSettlement";
import { persistTurnOutputs } from "./commodity/persistence";
import { loadBlockadeClosure } from "./commodity/blockadeClosure";
import { bookExtractionDepletion } from "./commodity/extractionDepletion";

export interface CommodityPriceTurnResult {
  commoditiesUpdated: number;
  statesWithActivity: number;
  /** Total ₳ value of inter-country trade cleared this turn. */
  tradeClearedVolume: number;
}

/**
 * Compute and store commodity prices based on current owned sector supply/demand.
 * Called each turn after corporation turn processing.
 *
 * Retail sector demand is scaled by GDP growth (50% national average + 50% regional)
 * using the previous turn's GDP growth values from stateMetrics.
 *
 * Price formula per commodity:
 *   globalPrice  = computeMarketPrice(basePrice, globalSupply, globalDemand)
 *   nationalRaw  = computeMarketPrice(basePrice, countrySupply + stab, countryDemand + stab)
 *   regionalRaw  = computeMarketPrice(basePrice, stateSupply, stateDemand)
 *   blendedPrice = 0.5 × globalPrice + 0.25 × nationalRaw + 0.25 × regionalRaw
 *
 * COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND: regionalRaw falls through to nationalRaw
 * (financial, healthcare, advertising, real estate services), making the effective
 * blend 50% global + 50% national. State-level S/D is meaningless for these markets
 * because activity is driven by nationwide budgets, campaigns, or bond issuance.
 *
 * Only OWNED sectors count for supply/demand. Unowned does not participate.
 */
export async function processCommodityPriceTurn(turn: number): Promise<CommodityPriceTurnResult> {
  const db = await getDb();
  const now = new Date();
  // Window covers one game year (48 turns). Latent financial demand derives from
  // sovereign and corporate debt issuance within this window. Short windows (e.g. 12)
  // leave countries whose only bonds were seeded at game start with zero demand once
  // those bonds age out — the 1-year window keeps demand stable across countries with
  // infrequent sovereign issuance (JP, CA, DE).
  const debtIssuanceWindowStart = Math.max(0, turn - 48);

  // Fetch all owned sectors, GDP growth data, corporations, central banks, states, and budgets in parallel
  const [
    allSectors,
    allStateMetrics,
    allCorporations,
    centralBanks,
    allStates,
    recentBonds,
    federalBudgets,
    exchangeRateDocs,
    nudgeDocs,
    existingPrices,
    allStateBudgets,
  ] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        {},
        {
          projection: {
            sectorType: 1,
            revenue: 1,
            countryId: 1,
            stateId: 1,
            corporationId: 1,
            strategyId: 1,
            transitionFromStrategyId: 1,
            transitionStartTurn: 1,
            productionPolicyLevel: 1,
            // Plants tier: real production, capacity, cold/embargo state.
            producedUnits: 1,
            soldUnits: 1,
            capitalStock: 1,
            operatingCapacityUnits: 1,
            mothballed: 1,
            embargoSuspended: 1,
            embargoExportExposure: 1,
          },
        }
      )
      .toArray(),
    db
      // SP5: economic.* lives on macroMetrics.
      .collection<StateMetrics>("macroMetrics")
      .find(
        {},
        {
          projection: {
            "economic.gdpGrowth.value": 1,
            // Household Ledger signals (used only when householdConsumptionEnabled)
            "economic.medianIncome.value": 1,
            "economic.unemploymentRate.value": 1,
            "economic.consumerConfidence.value": 1,
            "infrastructure.roadCondition.value": 1,
          },
        }
      )
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find(
        {},
        {
          projection: {
            _id: 1,
            marketingBudget: 1,
            liquidCapital: 1,
            headquartersState: 1,
            countryOwnerId: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<CentralBank>("centralBanks")
      .find({})
      .project<Pick<CentralBank, "_id" | "countryId" | "primeRate">>({ countryId: 1, primeRate: 1 })
      .toArray(),
    db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, countryId: 1, gdp: 1, population: 1 } })
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find(
        { issuedAtTurn: { $gt: debtIssuanceWindowStart }, matured: false },
        { projection: { issuerType: 1, countryId: 1, corporationId: 1, totalIssued: 1 } }
      )
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      // The WHOLE category map, not named paths. This projection pinned
      // `healthcare` only, so when #3880 added the defense -> ordnance leg the
      // amount it needed was stripped before the loop ever saw it and the
      // feature has been inert ever since. It also hid the `health` spelling
      // that UK/CN/IE use. Projecting the map means adding a leg to
      // GOVT_SPEND_DEMAND cannot silently read zero again.
      .find({}, { projection: { countryId: 1, "spending.byCategory": 1, economicFactors: 1 } })
      .toArray(),
    db
      .collection<ExchangeRate>("exchangeRates")
      .find({})
      .project<Pick<ExchangeRate, "_id" | "currencyCode" | "rate">>({ currencyCode: 1, rate: 1 })
      .toArray(),
    // Admin-set one-turn price nudges for this turn
    db
      .collection<CommodityPrice>("commodityPrices")
      .find({ nudgeTurn: turn, nudgePrice: { $ne: null } } as Record<string, unknown>, {
        projection: { commodity: 1, nudgePrice: 1 },
      })
      .toArray(),
    // Existing commodity prices for drift baseline and peg state
    db
      .collection<CommodityPrice>("commodityPrices")
      .find(
        {},
        {
          projection: {
            commodity: 1,
            globalPrice: 1,
            statePrices: 1,
            hardPeg: 1,
            stateHardPegs: 1,
            stateNudges: 1,
            scarcityMult: 1,
            scarcityMultByCountry: 1,
            // Plants household re-anchor: prior global supply for the
            // PLANTS_HOUSEHOLD_SUPPLY_CAP clamp.
            globalSupply: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find({}, { projection: { stateId: 1, stateGdp: 1 } })
      .toArray(),
  ]);

  // Build set of natcorp corporation IDs (country-owned enterprises)
  const natcorpIds = new Set(
    allCorporations
      .filter((c: Corporation) => !!c.countryOwnerId)
      .map((c: Corporation) => c._id.toString())
  );

  // Per-corp FX lookup: normalize corp-level fields such as marketingBudget
  // before feeding commodity-demand math, so corps in different home currencies
  // contribute correctly to shared supply/demand curves.
  // fxByCurrency is also used later for government healthcare-spending
  // normalization (line ~410) — declared once here and reused below.
  const fxByCurrency = new Map<CurrencyCode, number>(
    exchangeRateDocs.map((r) => [r.currencyCode as CurrencyCode, r.rate])
  );
  if (!fxByCurrency.has("USD")) fxByCurrency.set("USD", 1.0);

  // Budget-only economies (the six Warsaw Pact members of #3778 §1) are not in
  // FOREX_ACTIVE_COUNTRIES, so `seedExchangeRates` never writes them a row and
  // `fxByCurrency` has no entry. Falling straight through to 1.0 reads their
  // budgets as though 1 złoty = ₳1, inflating every ₳-normalized demand they
  // contribute. The authored era rate is the correct answer, so resolve it from
  // the preset's table before conceding to 1.0. INITIAL_RATES (2019) stays as
  // the last resort for an unknown preset, matching prior behaviour.
  const presetState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      // `currentYear` rides along for the planned-economy output remap below —
      // widening this projection rather than adding a read, so the positional
      // fetch order the turn tests mock stays exactly as it is.
      projection: { preset: 1, currentYear: 1 },
    }
  );
  const activePreset = presetState?.preset ?? "";
  const ledgerCurrentYear = presetState?.currentYear ?? null;
  for (const code of Object.values(COUNTRY_CURRENCY_MAP) as CurrencyCode[]) {
    if (fxByCurrency.has(code)) continue;
    const authoredRate = eraRateForCurrency(code, activePreset);
    if (authoredRate !== undefined) fxByCurrency.set(code, authoredRate);
  }
  // Resolved here, above the supply ledger, because a command economy's media
  // produces state information rather than sold advertising. Safe to add: every
  // positional cursor the turn tests stub is already consumed by the parallel
  // block above, so reads from here on fall through to the catch-all.
  const ledgerConfig = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        commandEconomyEnabled: 1,
        retailDemandTransitionStartTurn: 1,
        retailDemandTransitionTurns: 1,
        commodityNominalPriceIndex: 1,
        commodityNominalPriceIndexTurn: 1,
      },
    }
  );
  const nominalIndices = resolveCommodityNominalIndices({
    index: ledgerConfig?.commodityNominalPriceIndex,
    lastTurn: ledgerConfig?.commodityNominalPriceIndexTurn,
    currentTurn: turn,
    countryInflationRates: federalBudgets.map(
      (budget) => budget.economicFactors?.inflationRate ?? Number.NaN
    ),
  });
  const commodityNominalPriceIndex = nominalIndices.current;
  const ledgerCommandEconomyEnabled = ledgerConfig?.commandEconomyEnabled === true;
  const eraRates = getInitialRates(activePreset);
  /** ₳-normalizing FX rate for a country's budget, era-aware. */
  const fxRateForCountry = (countryId: string | undefined): number => {
    const code = (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
      "USD") as CurrencyCode;
    return (
      fxByCurrency.get(code) ??
      eraRates[countryId as CountryId] ??
      INITIAL_RATES[countryId as CountryId] ??
      1.0
    );
  };

  const currencyByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
  const corporationById = new Map<string, Corporation>();
  for (const corp of allCorporations) {
    corporationById.set(corp._id.toString(), corp);
    currencyByCorpId.set(corp._id.toString(), {
      code: resolveCorpLiquidCurrencyCode(corp),
      rate: fxRateForCorpFromMap(corp, fxByCurrency),
    });
  }

  // ── Supply-ledger inputs ──────────────────────────────────────────────
  const { stateGdpMap, stateToCountry, roadConditionByState } = buildStateLookups(
    allStates,
    allStateMetrics
  );

  // Plants tier: the world ledger reads real production instead of the revenue
  // nameplate. Resolved once and reused by the flow-ledger block below.
  const marketSystemMode = await getMarketSystemMode();
  const plantsLedgerEnabled = marketAtLeast(marketSystemMode, "plants");
  const ledgerEraUnitScale = await loadWorldEraUnitScale(db);
  // The WHOLE ledger runs on the era base-price table: unit conversions scale,
  // mix-weight ratios cancel, and computed price LEVELS land on the same era
  // magnitudes seedCommodityPrices writes. One substitution, one basis — the
  // plants supply override (producedUnits, era units) and the demand legs below
  // must never sit on different unit bases or clearing and shortfall damages
  // compare incommensurable quantities. Identical table at scale 1.
  const LEDGER_BASE_PRICES = eraScaledBasePrices(ledgerEraUnitScale);

  // sectorId → realized ÷ nameplate extraction output. Filled by the extraction
  // block below (plants only) and read TWICE: once to book depletion, once to
  // scale the extraction SUPPLY contribution to the world ledger. Those two must
  // read the same number — see the note at the supply leg in `commodities.ts`.
  const realizedFractionBySectorId = new Map<string, number>();

  const sectorData = buildSectorRows({
    allSectors,
    corporationById,
    natcorpIds,
    fxByCurrency,
    stateToCountry,
    ledgerCurrentYear,
    ledgerCommandEconomyEnabled,
    turn,
  });

  const gdpGrowthData = buildGdpGrowthData(allStateMetrics, stateGdpMap);

  // Central bank rates by country (needed for both real estate demand and financial demand)
  const centralBankByCountry = new Map<string, number>(
    centralBanks.map((b) => [b.countryId, b.primeRate])
  );
  const primeRateByState = buildPrimeRateByState(allStates, centralBankByCountry);

  // Structural extraction-shortage stabilizer (audit t873): boosts extraction
  // supply per-resource. Read once and threaded into both the capacity-check
  // input (below) and the raw S/D accumulation so the two stay consistent.
  const extractionOutputScaleEnabled = await getExtractionOutputScaleEnabled();
  const demographicsDemandEnabled = await getDemographicsDemandEnabled();
  const householdConsumptionEnabled = await getHouseholdConsumptionEnabled();
  const retailSelfLoopFactor =
    plantsLedgerEnabled && householdConsumptionEnabled
      ? retailLegacyDemandFactor(ledgerConfig, turn)
      : 1;

  // Pre-compute extraction capacity multipliers
  const extractionSectors = sectorData.filter((s) => s.sectorType === "extraction");
  let extractionMultipliers: Map<string, Partial<Record<ExtractableResource, number>>> | undefined;

  if (extractionSectors.length > 0) {
    const stateIds = [...new Set(extractionSectors.map((s) => s.stateId))];
    const [capacityDocs, activeContracts] = await Promise.all([
      (await getStateResourceCapacityCollection(db)).find({ stateId: { $in: stateIds } }).toArray(),
      (await getExtractionContractsCollection(db))
        .find({ stateId: { $in: stateIds }, ...activeExtractionContractFilter() })
        .toArray(),
    ]);

    const extractionInputs = buildExtractionRevenueInputs(
      extractionSectors,
      turn,
      LEDGER_BASE_PRICES,
      extractionOutputScaleEnabled,
      realizedFractionBySectorId
    );

    // P3b (plants only): deposits are FINITE. Ration against the
    // depletion-adjusted ceiling — min(per-turn flow, units left in the ground)
    // — and then book this turn's extraction against the reserve. Below plants
    // `depletedCapacityDoc` is never called and both the rationing and the
    // (absent) depletion write are byte-identical to before.
    // Reuses `plantsLedgerEnabled` (resolved once above from `marketSystemMode`)
    // instead of re-reading gameConfig — same value, one fewer round trip, and
    // no way for the two reads to disagree mid-turn.
    const plantsEnabled = plantsLedgerEnabled;
    const rationingDocs = plantsEnabled ? capacityDocs.map(depletedCapacityDoc) : capacityDocs;
    extractionMultipliers = computeExtractionCapacityMultipliers(
      extractionInputs,
      activeContracts,
      rationingDocs
    );
    if (plantsEnabled) {
      await bookExtractionDepletion(
        db,
        extractionInputs,
        extractionMultipliers,
        now,
        realizedFractionBySectorId
      );
    }
  }

  // World Events v1 Phase 1: active sectorDemandModifier world-event
  // effects (e.g. royal-event's tourism bump), batch-loaded once per turn.
  const [sectorDemandModifierPct, sectorOutputDemandModifierPct] = await Promise.all([
    loadActiveSectorDemandModifierPctMap(db, turn),
    loadActiveSectorOutputDemandModifierPctMap(db, turn),
  ]);

  // EXTRACTION SUPPLY = REAL RATIONED OUTPUT (plants); see the ledger note in
  // the original — depletion is booked on nameplate × rationing ×
  // realizedFraction, so the supply leg reads the SAME fraction here.
  if (plantsLedgerEnabled && realizedFractionBySectorId.size > 0) {
    for (const sector of sectorData) {
      const f = sector.sectorId ? realizedFractionBySectorId.get(sector.sectorId) : undefined;
      if (typeof f === "number") sector.extractionRealizedFraction = f;
    }
  }

  // Compute raw supply/demand in units (retail demand scaled by GDP growth)
  const { global, byState, demandTruncated } = computeRawSupplyDemand(
    sectorData,
    gdpGrowthData,
    stateGdpMap,
    turn,
    primeRateByState,
    extractionMultipliers,
    extractionOutputScaleEnabled,
    sectorDemandModifierPct,
    householdConsumptionEnabled,
    plantsLedgerEnabled,
    // Era plants worlds (ticket #1027 phase 2): express every dollars-derived
    // ledger leg in the SAME era unit basis plants `producedUnits` uses. Below
    // plants, and on modern worlds (eraUnitScale 1), this is a pure no-op.
    plantsLedgerEnabled ? ledgerEraUnitScale : 1,
    sectorOutputDemandModifierPct,
    retailSelfLoopFactor,
    // Issue #2054: the same era table the clearing offer splits on, so the
    // measured-production mix split is weight-identical on both sides.
    LEDGER_BASE_PRICES
  );

  // Plants-tier produced/sold units for the inventory advance (see module).
  const plantsUnitsByCommodity = plantsLedgerEnabled
    ? accumulatePlantsUnits(sectorData, turn, LEDGER_BASE_PRICES)
    : new Map<CommodityType, { produced: number; sold: number }>();

  // Tier-2 sphere-macro countries: held contribution from the last six-turn
  // kernel tick participates in every normal-turn global market calculation,
  // routed through primary-sphere rules so secondary ties cannot duplicate
  // the full benefit package (#3717).
  await applySphereRoutedMacroContributions(db, global, turn);

  // ── Demand legs ───────────────────────────────────────────────────────
  applyAdvertisingDemand(
    {
      allCorporations,
      currencyByCorpId,
      advertisingBasePrice: LEDGER_BASE_PRICES["advertising"],
    },
    global,
    byState
  );

  if (demographicsDemandEnabled) {
    applyDemographicsUplift(allStates, global, byState);
  }

  if (householdConsumptionEnabled) {
    // Optional per-world sizing override (sandbox tuning without a redeploy).
    const pcCfg = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { householdConsumptionPerCapita: 1 } });
    const perCapitaOverride =
      typeof pcCfg?.householdConsumptionPerCapita === "number" &&
      pcCfg.householdConsumptionPerCapita > 0
        ? pcCfg.householdConsumptionPerCapita
        : undefined;
    const { metricsByState, priorGlobalPrice, priorGlobalSupply } = collectHouseholdSignals({
      allStateMetrics,
      existingPrices,
    });
    applyHouseholdDemand(
      {
        eraUnitScale: ledgerEraUnitScale,
        // Plants worlds: re-anchor household demand onto the physical unit basis
        // plants supply uses, clamped per commodity against prior supply. Legacy
        // worlds pass 1/undefined and are byte-identical (ticket #1027).
        plantsUnitScale: plantsLedgerEnabled ? PLANTS_HOUSEHOLD_UNIT_SCALE : 1,
        priorGlobalSupply: plantsLedgerEnabled ? priorGlobalSupply : undefined,
        states: allStates.map((s) => ({
          stateId: s._id,
          countryId: s.countryId,
          gdp: s.gdp ?? 0,
          population: s.population ?? 0,
        })),
        metricsByState,
        priorGlobalPrice,
        perCapita: perCapitaOverride,
      },
      global,
      byState,
      demandTruncated
    );
  }

  // Built once here: sovereign issuance allocation (latent financial leg) and
  // government regional distribution read the same country → state-GDP shares.
  const statesByCountry = buildStatesByCountry(allStates);

  applyLatentFinancialDemand(
    { statesByCountry, allCorporations, recentBonds, centralBankByCountry },
    global,
    byState
  );

  applyRateSensitiveDemand(
    {
      allStateBudgets,
      stateToCountry,
      fxRateForCountry,
      centralBankByCountry,
      ledgerBasePrices: LEDGER_BASE_PRICES,
    },
    global,
    byState
  );

  // ── National (country-aggregate) commodity balances ───────────────────
  // Sector-allocated S/D (including advertising, latent financial). Healthcare
  // govt demand is applied after this block so it can be attributed per country.
  const byCountry = aggregateByCountry(byState, stateToCountry);

  // ── Government spending → commodity demand ────────────────────────────
  applyGovernmentDemand(
    {
      federalBudgets,
      ledgerBasePrices: LEDGER_BASE_PRICES,
      fxRateForCountry,
      ledgerCurrentYear,
      ledgerCommandEconomyEnabled,
      statesByCountry,
      stateToCountry,
    },
    global,
    byCountry,
    byState
  );

  // ── Inter-country trade clearing + whole-market dampened convergence ──
  // (Ordering and influence-lever notes live with the original; the WTO/FTA /
  // embargo loads stay here, separate from the main parallel block to keep the
  // positional test fetches stable.)
  // Replay signed durable-embargo bills into legislation-origin embargo records
  // before reading them (mirrors tariff-bill reconcile). Minister embargoes are
  // untouched.
  await reconcileSignedEmbargoBills(db, turn);
  const [ftaPairs, orgMembershipDocs, tariffDocs, embargoDocs] = await Promise.all([
    loadActiveFtaPairs(db),
    db
      .collection<OrganizationMembership>("organizationMemberships")
      .find({}, { projection: { countryId: 1, organizationId: 1 } })
      .toArray(),
    db.collection<Tariff>("tariffs").find({}).toArray(),
    db
      .collection<TradeEmbargo>("tradeEmbargoes")
      .find({ $or: [{ expiresTurn: { $exists: false } }, { expiresTurn: { $gte: turn } }] })
      .toArray(),
  ]);
  const blocsByCountry = buildBlocsByCountry(orgMembershipDocs);
  const curtainedCountries = buildCurtainedCountries(
    ledgerCurrentYear,
    ledgerCommandEconomyEnabled
  );
  // Naval blockade pressure, read fresh rather than from persisted navair state.
  //
  // `commodityPrices` runs EARLIER in the turn than `navairOperations`, so reading the
  // persisted channels here would silently use last turn's dispositions: a blockade
  // would take a turn to bite and nothing in the output would say so. The read is one
  // indexed query (militaryUnits_domain) and returns an empty map whenever nobody is
  // blockading anybody, which is the common case.
  const blockadeClosure = await loadBlockadeClosure(db);

  const { affinityFor, capUnitsFor } = buildTradeAffinity({
    ftaPairs,
    blocsByCountry,
    tariffs: tariffDocs,
    embargoes: embargoDocs,
    curtainedCountries,
    blockadeClosure,
  });

  // Build existing price map early: the sourcing pass uses LAST turn's stored
  // prices as fixed asks, and the drift baseline below reuses the same map.
  const existingPriceMap = new Map<string, CommodityPrice>(
    existingPrices.map((p) => [p.commodity, p])
  );

  // ── Landed-price freight settlement (shadow or active) ─────────────────
  const { freightSettlement, freightRampFraction, freightSettlementActive } =
    await runFreightSettlementPhase(
      db,
      {
        marketSystemMode,
        allStates,
        stateToCountry,
        roadConditionByState,
        existingPriceMap,
        ledgerBasePrices: LEDGER_BASE_PRICES,
        ledgerEraUnitScale,
        tariffDocs,
        ftaPairs,
        affinityFor,
      },
      turn,
      now,
      global,
      byState,
      byCountry
    );

  const tradeClearing = clearAllCommodities(COUNTRY_ORDER, byCountry, affinityFor, capUnitsFor);
  // Reachable books, built from the SAME pre-convergence balances the clearing
  // ran on. `applyTradeConvergence` mutates `byCountry` in place on the next
  // line, so this cannot move below it: post-convergence an importer's demand
  // has already been relieved by k x imports and every deficit reads short by
  // that factor. Persisted with the flow snapshot so read surfaces quote the
  // book the engine actually clears on rather than the global aggregate
  // (ticket #1077).
  const reachableBooks = buildReachableBooks({
    countries: COUNTRY_ORDER,
    balances: byCountry,
    clearing: tradeClearing,
    commodities: COMMODITY_TYPES,
    affinity: affinityFor,
  });
  applyTradeConvergence(COUNTRY_ORDER, byCountry, tradeClearing, TRADE_PRICE_CONVERGENCE_K);

  // Build nudge map from the parallel-fetched nudge docs
  const nudgeMap = buildNudgeMap(nudgeDocs);

  // Scarcity drift (persistent-imbalance integrator): config-gated so it can
  // be flipped live without a deploy. When off, multipliers reset to 1 so the
  // economy returns to the memoryless baseline within one turn.
  const marketFlagsConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" } as Record<string, unknown>, {
      projection: {
        commodityScarcityDriftEnabled: 1,
        stockCoverCapEnabled: 1,
        commandEconomyEnabled: 1,
      },
    });
  const scarcityDriftEnabled = marketFlagsConfig?.commodityScarcityDriftEnabled === true;
  // Administered pricing for planned economies (P2). Country-scoped to the
  // NATIONAL leg only — never the shared global leg.
  const commandEconomyEnabled = marketFlagsConfig?.commandEconomyEnabled === true;
  const priceGameState = commandEconomyEnabled
    ? await db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentYear: 1 } })
    : null;
  const priceCurrentYear = priceGameState?.currentYear ?? null;
  // Legacy-stockpile cover cap: accelerated spoilage on shadow stock above
  // STOCK_COVER_CAP_TURNS × demand. Config-gated so it can be flipped live.
  const stockCoverCapEnabled = marketFlagsConfig?.stockCoverCapEnabled === true;
  const scarcityMultByCommodity = new Map<CommodityType, number>();

  // Calculate prices for each commodity
  const ops: {
    updateOne: {
      filter: { commodity: CommodityType };
      update: { $set: Omit<CommodityPrice, "commodity"> };
      upsert: boolean;
    };
  }[] = [];

  const statesWithActivity = new Set<string>();
  // Collect actual applied prices for history snapshots
  const appliedGlobalPrices = new Map<CommodityType, number>();
  const appliedStatePrices = new Map<CommodityType, Record<string, number>>();
  const appliedNationalPrices = new Map<CommodityType, Record<string, number>>();

  // ── Era-aware demand calibration ──────────────────────────────────────
  // Applied once, after every demand generator has contributed and before any
  // price is computed, so the global, national and regional legs and the
  // commodityFlows record all see the same corrected figure.
  applyDemandCalibration({ activePreset }, global, byCountry, byState);

  // Lagged price ratios for producer cost pass-through (see module).
  const laggedRatios = buildLaggedRatios(
    LEDGER_BASE_PRICES,
    existingPriceMap,
    nominalIndices.lagged
  );

  const pricingCtx: CommodityPricingContext = {
    ledgerBasePrices: LEDGER_BASE_PRICES,
    commodityNominalPriceIndex,
    scarcityDriftEnabled,
    commandEconomyEnabled,
    priceCurrentYear,
    freightSettlementActive,
    freightRampFraction,
    freightSettlement,
    existingPriceMap,
    nudgeMap,
    laggedRatios,
    reachableBooks,
    global,
    byCountry,
    byState,
    allStates,
    stateToCountry,
    demandTruncated,
    scarcityMultByCommodity,
    appliedGlobalPrices,
    appliedStatePrices,
    appliedNationalPrices,
    turn,
    now,
  };
  for (const commodity of COMMODITY_TYPES) {
    const { priceOp } = priceCommodity(pricingCtx, commodity, statesWithActivity);
    ops.push(
      priceOp as {
        updateOne: {
          filter: { commodity: CommodityType };
          update: { $set: Omit<CommodityPrice, "commodity"> };
          upsert: boolean;
        };
      }
    );
  }

  if (ops.length > 0) {
    await db.collection("commodityPrices").bulkWrite(ops);
  }
  await persistCommodityNominalIndex(db, commodityNominalPriceIndex, turn);

  // ── Persistence tail: history, flow ledger, trade snapshot ────────────
  const { tradeClearedVolume } = await persistTurnOutputs(
    db,
    {
      marketSystemMode,
      global,
      byCountry,
      demandTruncated,
      appliedGlobalPrices,
      appliedStatePrices,
      appliedNationalPrices,
      scarcityMultByCommodity,
      ledgerBasePrices: LEDGER_BASE_PRICES,
      commodityNominalPriceIndex,
      stockCoverCapEnabled,
      plantsUnitsByCommodity: plantsLedgerEnabled ? plantsUnitsByCommodity : undefined,
      tradeClearing,
      reachableBooks,
      countries: COUNTRY_ORDER,
    },
    turn,
    now
  );

  return {
    commoditiesUpdated: COMMODITY_TYPES.length,
    statesWithActivity: statesWithActivity.size,
    tradeClearedVolume,
  };
}
