import { getDb } from "@/lib/mongodb";
import { freshMilitaryDiversion } from "@/lib/military/arsenal";
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
  MONETARY_BASELINES,
  getInitialRates,
} from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { commodityDemandCalibration } from "@/lib/constants/commodityDemandCalibration";
import {
  COMMODITY_TYPES,
  eraScaledBasePrices,
  MARKETING_ADVERTISING_DEMAND_RATE,
  GOVT_HEALTHCARE_DEMAND_RATE,
  GOVT_DEFENSE_ORDNANCE_DEMAND_RATE,
  GOVT_SPEND_CATEGORY_ALIASES,
  govtSpendForCategory,
  STATE_MEDIA_DEMAND_RATE,
  COMMODITY_PRICE_DRIFT_RATE,
  NATIONAL_COMMODITY_STABILIZER,
  COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND,
  EXTRACTABLE_RESOURCES,
  SECTOR_SUPPLY,
  extractionOutputScaleFor,
  FINANCIAL_NEUTRAL_RATE,
  FOOD_RATE_GDP_FRACTION,
  VEHICLE_RATE_GDP_FRACTION,
  FINANCIAL_RATE_GDP_FRACTION,
  computeRawSupplyDemand,
  computeMarketPrice,
  blendPrice,
  computeLatentFinancialDemand,
  getPriceSoftKnee,
  DEMOGRAPHIC_CONSUMER_COMMODITIES,
  DEMOGRAPHIC_UPLIFT_PCT,
  demographicWealthMultiplier,
  commodityMixWeight,
  embargoSupplyFactorFor,
  plantsSupplyScaledUnits,
} from "@/lib/constants/commodities";
import { updateScarcityMultiplier } from "@/lib/market/scarcityDrift";
import { loadActiveSectorDemandModifierPctMap } from "@/lib/events/worldEvents/sectorDemandModifierMap";
import {
  getMarketSystemMode,
  marketAtLeast,
  getExtractionOutputScaleEnabled,
  getDemographicsDemandEnabled,
  getHouseholdConsumptionEnabled,
} from "@/lib/market/featureFlag";
import {
  computeHouseholdConsumption,
  PLANTS_HOUSEHOLD_UNIT_SCALE,
  type HouseholdStateSignals,
} from "@/lib/turn/householdConsumption";
import { buildCommodityFlowDocs, COMMODITY_FLOW_RETENTION_TURNS } from "@/lib/market/flowLedger";
import { applyFreightHaulDemand } from "@/lib/logistics/freightDemand";
import { settleFreightNetwork, type FreightSettlement } from "@/lib/logistics/settlement";
import { buildSourcingDocs, SOURCING_FLOW_RETENTION_TURNS } from "@/lib/logistics/sourcingLedger";
import { stateHops } from "@/lib/logistics/stateDistance";
import { importerTariffOnFlow } from "@/lib/trade/tariffDrag";
import { PRIMARY_SECTOR_BY_COMMODITY } from "@/lib/trade/commoditySector";
import type {
  CommodityType,
  GdpGrowthData,
  ExtractableResource,
} from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { computeExtractionCapacityMultipliers } from "@/lib/turn/extraction/extractionCapacity";
import type { ExtractionSectorInput } from "@/lib/turn/extraction/extractionCapacity";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import {
  getExtractionContractsCollection,
  activeExtractionContractFilter,
} from "@/lib/db/collections/extractionContracts";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { State } from "@/lib/db/types/state";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import { isPlannedEconomy, plannedShare } from "@/lib/constants/commandEconomy";
import { administeredNationalPrice, dualTrackPrice } from "@/lib/economy/administeredPricing";
import type { GameState } from "@/lib/db/types/gameState";
import { clearAllCommodities, valueTradeSnapshot } from "@/lib/trade/snapshot";
import { buildReachableBooks, serializeReachableBooks } from "@/lib/trade/reachableBook";
import { applyTradeConvergence } from "@/lib/trade/convergence";
import { buildTradeAffinity } from "@/lib/trade/tradeAffinity";
import { TRADE_PRICE_CONVERGENCE_K } from "@/lib/trade/constants";
import { loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import { reconcileSignedEmbargoBills } from "@/lib/trade/reconcileEmbargoes";
import type { Tariff } from "@/lib/db/types/tariff";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import { applySphereRoutedMacroContributions } from "@/lib/world/spheres";
import { impliedOutputUnits } from "@/lib/market/capital";
import type { Db } from "mongodb";
import { depletedCapacityDoc, buildDepletionInc } from "@/lib/extraction/depletion";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

/**
 * P3b — book this turn's extraction against each state's deposits (plants only).
 *
 * Produced units per (state, resource) are the rationed output the multipliers
 * just resolved, summed over the state's sectors, so the ground gives up
 * precisely what the world receives.
 *
 * ACCURACY: `revenueBasedOutput` derives from `sector.revenue`, which under
 * plants is the CAPACITY NAMEPLATE, not realized output — booking against it
 * omits `plantsExtractionHardMin`'s ramp lambda, the throughput factor and the
 * revenue multiplier, so during the ramp the ground was debited for more ore
 * than was actually mined. When the sector has a persisted `producedUnits`
 * (written only under plants) we scale the per-resource nameplate split by
 * realized ÷ nameplate instead: the resource MIX still comes from the nameplate
 * split (producedUnits is a single scalar across the sector's whole mix), but
 * the LEVEL is the realized one. Below plants `producedUnits` is never written,
 * so the fallback keeps the old derivation byte-identical.
 *
 * One `$inc` per state, on the monotonic `extractedUnits` counter — no read-
 * modify-write, so concurrent turn phases cannot lose extraction.
 *
 * Matched on `stateId` alone, deliberately consistent with the read side above
 * (`capacityDocs` is fetched by stateId and `computeExtractionCapacityMultipliers`
 * keys by stateId): the rationing this books against already resolves a
 * cross-country state-id collision to one doc, and the write must land on the
 * same one it rationed with.
 */
/**
 * Realized ÷ nameplate output for one sector, clamped to [0, 1] at BOTH ends.
 *
 * The lower clamp guards a negative produced figure. The upper clamp guards a
 * `revenue` that is stale-LOW relative to the capacity that produced the units:
 * the concrete case is a NatCorp sector minted by `nationalizeSectorWide`, which
 * writes a 15%-haircut revenue alongside FULL capacity, so until its first
 * `sectorTurn` restates `revenue` the raw ratio reads ~1.18. This fraction scales
 * extraction DEPLETION, so an unclamped value quietly mines more out of the
 * ground than the sector can physically have produced. A sector can never
 * realize more than its own nameplate, so 1 is the correct ceiling.
 *
 * Returns null when there is no meaningful measurement (non-positive nameplate),
 * which callers treat as "leave the booking at the nameplate derivation".
 */
export function realizedOutputFraction(
  producedUnits: number,
  nameplateUnits: number
): number | null {
  if (!Number.isFinite(nameplateUnits) || nameplateUnits <= 0) return null;
  if (!Number.isFinite(producedUnits)) return null;
  return Math.min(1, Math.max(0, producedUnits / nameplateUnits));
}

async function bookExtractionDepletion(
  db: Db,
  inputs: ReadonlyArray<ExtractionSectorInput>,
  multipliers: Map<string, Partial<Record<ExtractableResource, number>>>,
  now: Date,
  /**
   * sectorId → realized ÷ nameplate output. 1 (or absent) means "no realized
   * measurement for this sector", which is the pre-plants case and keeps the
   * booking identical to the nameplate derivation.
   */
  realizedFractionBySectorId?: ReadonlyMap<string, number>
): Promise<void> {
  const producedByState = new Map<string, Partial<Record<ExtractableResource, number>>>();
  for (const input of inputs) {
    const mult = multipliers.get(input.sectorId);
    const realizedFraction = realizedFractionBySectorId?.get(input.sectorId) ?? 1;
    const acc = producedByState.get(input.stateId) ?? {};
    for (const resource of Object.keys(input.revenueBasedOutput) as ExtractableResource[]) {
      const potential = input.revenueBasedOutput[resource] ?? 0;
      if (!(potential > 0)) continue;
      const produced = potential * (mult?.[resource] ?? 1) * realizedFraction;
      if (produced > 0) acc[resource] = (acc[resource] ?? 0) + produced;
    }
    producedByState.set(input.stateId, acc);
  }
  const ops = [];
  for (const [stateId, produced] of producedByState) {
    const inc = buildDepletionInc(produced);
    if (Object.keys(inc).length === 0) continue;
    ops.push({
      updateOne: { filter: { stateId }, update: { $inc: inc, $set: { updatedAt: now } } },
    });
  }
  if (ops.length === 0) return;
  const col = await getStateResourceCapacityCollection(db);
  await col.bulkWrite(ops as Parameters<typeof col.bulkWrite>[0]);
}

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
      .find({}, { projection: { countryId: 1, "spending.byCategory": 1 } })
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

  // Per-corp FX lookup: normalize sector.revenue and marketingBudget to ₳
  // before feeding commodity-demand math, so corps in different home
  // currencies contribute correctly to shared supply/demand curves.
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
  // Resolved here, above the supply ledger, because a command economy's media
  // produces state information rather than sold advertising. Safe to add: every
  // positional cursor the turn tests stub is already consumed by the parallel
  // block above, so reads from here on fall through to the catch-all.
  const ledgerCommandEconomyEnabled =
    (
      await db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } })
    )?.commandEconomyEnabled === true;
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
  for (const corp of allCorporations) {
    currencyByCorpId.set(corp._id.toString(), {
      code: resolveCorpLiquidCurrencyCode(corp),
      rate: fxRateForCorpFromMap(corp, fxByCurrency),
    });
  }

  // Build state GDP map + stateId->countryId lookup first — the latter is
  // used both by the national aggregation block below and (World Events v1
  // Phase 1) to stamp each sector with its countryId for sectorDemandModifier
  // lookups.
  const stateGdpMap = new Map<string, number>();
  // stateToCountry used by national aggregation block below
  const stateToCountry = new Map<string, string>();
  const roadConditionByState = new Map<string, number>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    stateToCountry.set(state._id, state.countryId);
    if (state.gdp && state.gdp > 0) {
      stateGdpMap.set(state._id, state.gdp);
    }
  }
  for (const metrics of allStateMetrics) {
    const road = metrics.infrastructure?.roadCondition?.value;
    if (typeof road === "number" && Number.isFinite(road)) {
      roadConditionByState.set(String(metrics._id), road);
    }
  }

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
  // Hoisted above `sectorData` so the second read can be attached to it.
  const realizedFractionBySectorId = new Map<string, number>();

  const sectorData = allSectors.map((s: CorporateSector) => {
    const fx = currencyByCorpId.get(s.corporationId.toString());
    // Embargo symmetry: the same factor sectorTurn applies to this sector's
    // revenue (see the embargoRevenueFactor there) also scales the units it
    // contributes to world supply. A total-embargo suspension is a hard 0.
    // Routed through the shared `embargoSupplyFactorFor` (constants/commodities)
    // rather than re-derived here — that helper is the single source of the
    // formula, and the clearing offer in turn/corporation/index.ts reads it too.
    const embargoSupplyFactor = embargoSupplyFactorFor(s);
    return {
      sectorType: s.sectorType,
      // Anchor-normalize sector.revenue (LOCAL in corp currency post-Task-18A)
      // so cross-corp supply/demand aggregation compares coherent ₳.
      revenue: readCorpEconomicAnchor(s.revenue, fx?.code, fx?.rate ?? 1),
      stateId: s.stateId,
      // sectorId / corporationId threaded through for dev's extraction-capacity
      // plumbing — used by downstream pricing phases.
      sectorId: s._id.toString(),
      corporationId: s.corporationId,
      isNatcorp: natcorpIds.has(s.corporationId.toString()),
      strategyId: s.strategyId,
      transitionFromStrategyId: s.transitionFromStrategyId,
      transitionStartTurn: s.transitionStartTurn,
      productionPolicyLevel: s.productionPolicyLevel,
      // World Events v1 Phase 1: lets computeRawSupplyDemand apply active
      // sectorDemandModifier world-event effects (e.g. royal-event tourism
      // bump) to this sector's demand contribution.
      countryId: stateToCountry.get(s.stateId),
      // Command economies have no advertising market: their media output is
      // state information, re-denominated in the shared output remap.
      plannedEconomy: isPlannedEconomy(
        stateToCountry.get(s.stateId),
        ledgerCurrentYear,
        ledgerCommandEconomyEnabled
      ),
      // Plants tier: real measured output, capacity, and cold/embargo state.
      // Null when the sector has never run a plants turn — the ledger then
      // falls back to the legacy revenue derivation for it.
      producedUnits: typeof s.producedUnits === "number" ? s.producedUnits : null,
      // Output shipped to a state arsenal under a defence contract, which does not also
      // reach the market. Resolved for staleness here because this is where the turn is
      // known; the ledger itself only multiplies.
      militaryDivertedFraction: freshMilitaryDiversion(s, turn),
      soldUnits: typeof s.soldUnits === "number" ? s.soldUnits : null,
      capacityUnits: typeof s.capitalStock === "number" ? s.capitalStock : null,
      mothballed: s.mothballed === true,
      embargoSupplyFactor,
      // Filled in after the extraction block below (plants only). Declared here
      // so the inferred element type carries the field.
      extractionRealizedFraction: null as number | null,
    };
  });

  // Build GDP growth data for retail demand scaling.
  // Uses GDP-weighted average so larger economies contribute proportionally
  // more to the national growth signal (e.g. California matters more than Wyoming).
  const gdpByState = new Map<string, number>();
  let gdpWeightedSum = 0;
  let totalGdpWeight = 0;
  for (const sm of allStateMetrics) {
    const stateId = String(sm._id);
    if (NATIONAL_SCOPE_IDS.has(stateId)) continue;
    const gdpVal = sm.economic?.gdpGrowth?.value;
    const stateGdp = stateGdpMap.get(stateId) ?? 0;
    if (typeof gdpVal === "number") {
      gdpByState.set(stateId, gdpVal);
      if (stateGdp > 0) {
        gdpWeightedSum += gdpVal * stateGdp;
        totalGdpWeight += stateGdp;
      }
    }
  }
  const nationalAvgGdp = totalGdpWeight > 0 ? gdpWeightedSum / totalGdpWeight : 0;
  const gdpGrowthData: GdpGrowthData = {
    nationalAverage: nationalAvgGdp,
    byState: gdpByState,
  };

  // Central bank rates by country (needed for both real estate demand and financial demand)
  const centralBankByCountry = new Map<string, number>(
    centralBanks.map((b) => [b.countryId, b.primeRate])
  );

  // Build map of stateId -> primeRate for latent real estate demand
  const primeRateByState = new Map<string, number>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    const countryRate = centralBankByCountry.get(state.countryId);
    if (countryRate !== undefined) {
      primeRateByState.set(state._id, countryRate);
    }
  }

  // Structural extraction-shortage stabilizer (audit t873): boosts extraction
  // supply per-resource. Read once and threaded into both the capacity-check
  // input (below) and the raw S/D accumulation so the two stay consistent.
  const extractionOutputScaleEnabled = await getExtractionOutputScaleEnabled();
  const demographicsDemandEnabled = await getDemographicsDemandEnabled();
  const householdConsumptionEnabled = await getHouseholdConsumptionEnabled();

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

    // sectorId → realized ÷ nameplate output units, for the depletion booking
    // below. Nameplate here is `impliedOutputUnits(revenue)` — the SAME quantity
    // sectorTurn derived `producedUnits` from — summed over the sector's whole
    // priced supply mix, so the ratio is exactly the production legs (ramp
    // lambda, throughput, revenue multiplier) that the revenue nameplate does
    // not carry. Empty below plants, where `producedUnits` is never persisted.

    const extractionInputs: ExtractionSectorInput[] = extractionSectors.map((sector) => {
      const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
      const strategyRates =
        hasStrategy || sector.transitionFromStrategyId
          ? getEffectiveStrategyRates(
              "extraction",
              sector.strategyId ?? "standard",
              sector.transitionFromStrategyId,
              sector.transitionStartTurn,
              turn
            )
          : null;

      const revenueBasedOutput: Partial<Record<ExtractableResource, number>> = {};
      for (const resource of EXTRACTABLE_RESOURCES) {
        const rate = strategyRates
          ? (strategyRates.supply[resource] ?? 0)
          : ((SECTOR_SUPPLY["extraction"] ?? []).find((f) => f.commodity === resource)?.rate ?? 0);
        if (rate > 0) {
          // Same scale applied to the S/D accumulation, so the capacity haircut
          // is computed against the boosted output (fills idle deposit capacity).
          const scale = extractionOutputScaleFor(resource, extractionOutputScaleEnabled);
          revenueBasedOutput[resource] =
            (sector.revenue * rate * scale) / LEDGER_BASE_PRICES[resource];
        }
      }

      // A MOTHBALLED extraction sector is cold: it produces nothing, so it must
      // deplete nothing. Without this it fell through to the default fraction of
      // 1 below (`producedUnits` is not persisted for a plant that did not run)
      // and drained the state's deposit at the FULL nameplate rate while
      // `computeRawSupplyDemand` was correctly counting its supply as zero. That
      // is the exact zero-count asymmetry the plants supply override introduced:
      // free reserve destruction with no goods to show for it, and the cheapest
      // possible way to exhaust a rival's field. Explicit 0, not "absent".
      if (plantsLedgerEnabled && sector.mothballed === true) {
        realizedFractionBySectorId.set(sector.sectorId!, 0);
      } else if (typeof sector.producedUnits === "number") {
        const supplyRates =
          strategyRates?.supply ??
          Object.fromEntries((SECTOR_SUPPLY["extraction"] ?? []).map((f) => [f.commodity, f.rate]));
        // Scale 1: LEDGER_BASE_PRICES already carries the era unit basis.
        const nameplateUnits = impliedOutputUnits(
          sector.revenue,
          supplyRates as Partial<Record<CommodityType, number>>,
          LEDGER_BASE_PRICES,
          1
        );
        // Clamped at both ends — see `realizedOutputFraction` for why the UPPER
        // clamp matters (a stale-low `revenue` on a fresh NatCorp sector would
        // otherwise over-book depletion).
        const fraction = realizedOutputFraction(sector.producedUnits, nameplateUnits);
        if (fraction != null) {
          realizedFractionBySectorId.set(sector.sectorId!, fraction);
        }
      }

      return {
        sectorId: sector.sectorId!,
        stateId: sector.stateId,
        corporationId: sector.corporationId,
        revenueBasedOutput,
      };
    });

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
  const sectorDemandModifierPct = await loadActiveSectorDemandModifierPctMap(db, turn);

  // Compute raw supply/demand in units (retail demand scaled by GDP growth)
  // EXTRACTION SUPPLY = REAL RATIONED OUTPUT (plants).
  //
  // Extraction is deliberately excluded from the `producedUnits` supply override
  // in `computeRawSupplyDemand` (its rationing multipliers are applied inside
  // that loop, and `producedUnits` already carries its own capacity haircut, so
  // routing it through the override would double-count the haircut). The
  // consequence was an asymmetry: DEPLETION was booked on
  // `nameplate × rationing × realizedFraction` — the real output — while the
  // world SUPPLY ledger still counted `nameplate × rationing`, i.e. the
  // pre-ramp, pre-throughput figure. Extraction is the world's dominant
  // commodity supplier, so that gap systematically over-supplied every
  // extractable commodity and held their prices down, while the reserves drained
  // at the correct (lower) rate. The two legs now read the SAME fraction.
  if (plantsLedgerEnabled && realizedFractionBySectorId.size > 0) {
    for (const sector of sectorData) {
      const f = sector.sectorId ? realizedFractionBySectorId.get(sector.sectorId) : undefined;
      if (typeof f === "number") sector.extractionRealizedFraction = f;
    }
  }

  const { global, byState } = computeRawSupplyDemand(
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
    // ledger leg (intermediate inputs, macro GDP demand, legacy nameplate
    // supply) in the SAME era unit basis plants `producedUnits` uses. Below
    // plants, and on modern worlds (eraUnitScale 1), this is a pure no-op.
    plantsLedgerEnabled ? ledgerEraUnitScale : 1
  );

  // Plants tier: per-commodity produced/sold units from corporate plants, split
  // across each sector's output mix by the SAME weights the supply ledger above
  // used. Feeds the inventory advance so unsold output lands in stock instead of
  // vanishing. Extraction is excluded for the same reason it is excluded from
  // the ledger's plants override (its rationing legs live elsewhere), and
  // mothballed plants contribute nothing on either side.
  const plantsUnitsByCommodity = new Map<CommodityType, { produced: number; sold: number }>();
  if (plantsLedgerEnabled) {
    for (const sector of sectorData) {
      if (sector.sectorType === "extraction" || sector.mothballed) continue;
      if (typeof sector.producedUnits !== "number") continue;
      const rates = getEffectiveStrategyRates(
        sector.sectorType as Parameters<typeof getEffectiveStrategyRates>[0],
        sector.strategyId ?? "standard",
        sector.transitionFromStrategyId,
        sector.transitionStartTurn,
        turn
      );
      const supplyRates = rates.supply ?? {};
      // Same legs the ledger applies on top of producedUnits (natcorpScale ×
      // outputMultiplier × embargoSupplyFactor), taken from the shared
      // `plantsSupplyScaledUnits` instead of re-derived here — that helper is
      // the single source of the chain and computeRawSupplyDemand plus the
      // clearing offer both call it. The chain is linear in `producedUnits`, so
      // the sold leg is the SAME call with soldUnits substituted; that is what
      // keeps produced and sold in identical units.
      const scaleArgs = {
        isNatcorp: sector.isNatcorp,
        productionPolicyLevel: sector.productionPolicyLevel,
        embargoSupplyFactor: sector.embargoSupplyFactor,
      };
      const produced =
        plantsSupplyScaledUnits({ ...scaleArgs, producedUnits: sector.producedUnits }) ?? 0;
      const sold =
        plantsSupplyScaledUnits({
          ...scaleArgs,
          producedUnits: sector.soldUnits ?? sector.producedUnits,
        }) ?? 0;
      for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
        const w = commodityMixWeight(supplyRates, LEDGER_BASE_PRICES, commodity);
        if (w <= 0) continue;
        const entry = plantsUnitsByCommodity.get(commodity) ?? { produced: 0, sold: 0 };
        entry.produced += produced * w;
        entry.sold += Math.min(produced, sold) * w;
        plantsUnitsByCommodity.set(commodity, entry);
      }
    }
  }

  // Tier-2 sphere-macro countries: held contribution from the last six-turn
  // kernel tick participates in every normal-turn global market calculation,
  // routed through primary-sphere rules so secondary ties cannot duplicate
  // the full benefit package (#3717).
  await applySphereRoutedMacroContributions(db, global, turn);

  // Corporate marketing budgets add demand to the advertising commodity.
  // Each $1 of daily marketing budget contributes MARKETING_ADVERTISING_DEMAND_RATE / basePrice
  // campaign-units of demand, distributed to the corporation's HQ state.
  // MARKETING_ADVERTISING_DEMAND_RATE / basePrice are ₳-calibrated, so we
  // normalize each corp's stored marketingBudget (local currency post-v0.2.6)
  // to ₳ before computing units — otherwise a UK corp's GBP budget would
  // over-contribute demand proportional to GBP's FX rate.
  const advertisingBasePrice = LEDGER_BASE_PRICES["advertising"];
  for (const corp of allCorporations) {
    const budgetLocal = corp.marketingBudget ?? 0;
    if (budgetLocal <= 0 || !corp.headquartersState) continue;
    const fx = currencyByCorpId.get(corp._id.toString());
    const budgetAnchor = readCorpEconomicAnchor(budgetLocal, fx?.code, fx?.rate ?? 1);
    const units = (budgetAnchor * MARKETING_ADVERTISING_DEMAND_RATE) / advertisingBasePrice;

    // Add to global
    const advertisingBal = global.get("advertising")!;
    advertisingBal.demand += units;

    // Distribute to HQ state so state-level margins reflect real demand
    if (!byState.has(corp.headquartersState)) {
      const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
      for (const c of COMMODITY_TYPES) {
        stateMap.set(c, { supply: 0, demand: 0 });
      }
      byState.set(corp.headquartersState, stateMap);
    }
    const stateBal = byState.get(corp.headquartersState)!.get("advertising")!;
    stateBal.demand += units;
  }

  // ── Demographics as a 4th demand source (demographicsDemandEnabled) ────────
  // Income demographics consume every commodity EXCEPT raw extractables, at a
  // per-capita rate that scales with POPULATION (linear) and GDP-per-capita
  // (wealthMult) — so the component grows as population and GDP grow. DEFAULT
  // OFF + conservative: adds a genuine new consumer to a shortage-prone market
  // and likely needs an output-rate boost before production enable.
  if (demographicsDemandEnabled) {
    const stateById = new Map(allStates.map((s) => [s._id, s]));
    for (const [stateId, stateMap] of byState) {
      const st = stateById.get(stateId);
      const population = st?.population ?? 0;
      const gdp = st?.gdp ?? 0;
      if (population <= 0) continue;
      const wealthMult = demographicWealthMultiplier(gdp, population);
      for (const commodity of DEMOGRAPHIC_CONSUMER_COMMODITIES) {
        const bal = stateMap.get(commodity);
        const existing = bal?.demand ?? 0;
        if (existing <= 0) continue;
        // Proportional uplift of existing demand — shock-free, and scales with
        // population/GDP (existing demand does) plus wealth (richer consume more).
        const uplift = existing * DEMOGRAPHIC_UPLIFT_PCT * wealthMult;
        if (uplift <= 0) continue;
        bal!.demand += uplift;
        global.get(commodity)!.demand += uplift;
      }
    }
  }

  // ── Household Ledger: income-driven final consumer demand ──────────────────
  // Turns per-state household signals (median income, employment, consumer
  // confidence) into consumer-basket demand with a bounded price-elasticity
  // response — the missing income→consumption loop. When on, retail's SECTOR_DEMAND
  // input proxy is suppressed in computeRawSupplyDemand above (the basket owns
  // those legs); the retail OUTPUT self-loop stays. DEFAULT OFF; supersedes the
  // demographics uplift — do not run both.
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
    const metricsByState = new Map<string, HouseholdStateSignals>();
    for (const m of allStateMetrics) {
      const econ = m.economic;
      if (!econ) continue;
      metricsByState.set(m._id, {
        medianIncome: econ.medianIncome?.value,
        unemploymentRate: econ.unemploymentRate?.value,
        consumerConfidence: econ.consumerConfidence?.value,
      });
    }
    const priorGlobalPrice = new Map<CommodityType, number>();
    const priorGlobalSupply = new Map<CommodityType, number>();
    for (const p of existingPrices) {
      if (typeof p.globalPrice === "number" && p.globalPrice > 0) {
        priorGlobalPrice.set(p.commodity as CommodityType, p.globalPrice);
      }
      if (typeof p.globalSupply === "number" && p.globalSupply > 0) {
        priorGlobalSupply.set(p.commodity as CommodityType, p.globalSupply);
      }
    }
    const household = computeHouseholdConsumption({
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
    });
    for (const [commodity, units] of household.global) {
      const g = global.get(commodity);
      if (g) g.demand += units;
    }
    for (const [stateId, contrib] of household.byState) {
      let stateMap = byState.get(stateId);
      if (!stateMap) {
        stateMap = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) stateMap.set(c, { supply: 0, demand: 0 });
        byState.set(stateId, stateMap);
      }
      for (const [commodity, units] of contrib) {
        const bal = stateMap.get(commodity);
        if (bal) bal.demand += units;
      }
    }
  }

  // ── Latent financial services demand from rate environment + debt issuance ─
  // Financial demand now follows bond-market activity instead of raw GDP.
  const statesByCountry = new Map<string, Map<string, number>>();
  for (const state of allStates) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    if (!state.gdp || state.gdp <= 0) continue;
    const countryId = state.countryId;
    if (!statesByCountry.has(countryId)) {
      statesByCountry.set(countryId, new Map());
    }
    statesByCountry.get(countryId)!.set(state._id, state.gdp);
  }

  const corporateHqById = new Map(
    allCorporations.map((corporation: Corporation) => [
      corporation._id.toString(),
      corporation.headquartersState,
    ])
  );
  const corporateCountryById = new Map(
    allCorporations.map((corporation: Corporation) => [
      corporation._id.toString(),
      corporation.countryId,
    ])
  );
  const stateDebtIssuanceByCountry = new Map<string, Map<string, number>>();

  for (const bond of recentBonds) {
    if (bond.issuerType === "sovereign" && bond.countryId) {
      const stateGdp = statesByCountry.get(bond.countryId);
      if (!stateGdp || stateGdp.size === 0) continue;
      const countryTotalGdp = [...stateGdp.values()].reduce((sum, value) => sum + value, 0);
      if (countryTotalGdp <= 0) continue;

      if (!stateDebtIssuanceByCountry.has(bond.countryId)) {
        stateDebtIssuanceByCountry.set(bond.countryId, new Map());
      }
      const issuanceByState = stateDebtIssuanceByCountry.get(bond.countryId)!;
      for (const [stateId, gdp] of stateGdp) {
        const allocation = bond.totalIssued * (gdp / countryTotalGdp);
        issuanceByState.set(stateId, (issuanceByState.get(stateId) ?? 0) + allocation);
      }
      continue;
    }

    const hqState = corporateHqById.get(bond.corporationId.toString());
    if (!hqState) continue;
    const countryId = corporateCountryById.get(bond.corporationId.toString());
    if (!countryId) continue;
    if (!stateDebtIssuanceByCountry.has(countryId)) {
      stateDebtIssuanceByCountry.set(countryId, new Map());
    }
    const issuanceByState = stateDebtIssuanceByCountry.get(countryId)!;
    issuanceByState.set(hqState, (issuanceByState.get(hqState) ?? 0) + bond.totalIssued);
  }

  for (const [countryId, stateDebtIssuance] of stateDebtIssuanceByCountry) {
    const primeRate = centralBankByCountry.get(countryId);
    if (primeRate === undefined) continue;

    const latentDemand = computeLatentFinancialDemand({
      primeRate,
      stateDebtIssuance,
    });

    for (const [stateId, units] of latentDemand) {
      // Add to global financial_services demand
      const g = global.get("financial_services")!;
      g.demand += units;

      // Add to state-level financial_services demand
      if (!byState.has(stateId)) {
        const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) {
          stateMap.set(c, { supply: 0, demand: 0 });
        }
        byState.set(stateId, stateMap);
      }
      const stateBal = byState.get(stateId)!.get("financial_services")!;
      stateBal.demand += units;
    }
  }

  // ── Rate-sensitive signed delta demand: food, vehicles, financial_services ──
  // delta = anchorGdp × fraction × (neutral - primeRate) / basePrice
  // Negative at high rates (suppresses demand), positive at low rates (adds demand).
  const anchorGdpByState = new Map<string, number>();
  for (const sb of allStateBudgets) {
    if (!sb.stateGdp || sb.stateGdp <= 0) continue;
    const countryId = stateToCountry.get(sb.stateId);
    if (!countryId) continue;
    const fxRate = fxRateForCountry(countryId);
    anchorGdpByState.set(sb.stateId, sb.stateGdp / fxRate);
  }

  const rateDemandCommodities: Array<{ commodity: CommodityType; fraction: number }> = [
    { commodity: "food", fraction: FOOD_RATE_GDP_FRACTION },
    { commodity: "vehicles", fraction: VEHICLE_RATE_GDP_FRACTION },
    { commodity: "financial_services", fraction: FINANCIAL_RATE_GDP_FRACTION },
  ];

  for (const { commodity, fraction } of rateDemandCommodities) {
    const basePrice = LEDGER_BASE_PRICES[commodity];
    const globalBal = global.get(commodity)!;

    for (const [stateId, anchorGdp] of anchorGdpByState) {
      const countryId = stateToCountry.get(stateId);
      if (!countryId) continue;
      const primeRate = centralBankByCountry.get(countryId) ?? FINANCIAL_NEUTRAL_RATE;
      const neutralRate =
        MONETARY_BASELINES[countryId as CountryId]?.neutralPrimeRate ?? FINANCIAL_NEUTRAL_RATE;
      const delta = (anchorGdp * fraction * (neutralRate - primeRate)) / basePrice;
      if (delta === 0) continue;

      globalBal.demand += delta;

      if (!byState.has(stateId)) {
        const stateMap = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) stateMap.set(c, { supply: 0, demand: 0 });
        byState.set(stateId, stateMap);
      }
      byState.get(stateId)!.get(commodity)!.demand += delta;
    }
  }

  // ── National (country-aggregate) commodity balances ──────────────────────
  // Sector-allocated S/D (including advertising, latent financial). Healthcare
  // govt demand is applied after this block so it can be attributed per country.
  // Aggregated national balances feed inflationRecalc as a cost-push signal.
  const byCountry = new Map<string, Map<CommodityType, { supply: number; demand: number }>>();
  for (const [stateId, stateMap] of byState) {
    const countryId = stateToCountry.get(stateId);
    if (!countryId) continue;
    if (!byCountry.has(countryId)) {
      const countryBals = new Map<CommodityType, { supply: number; demand: number }>();
      for (const c of COMMODITY_TYPES) countryBals.set(c, { supply: 0, demand: 0 });
      byCountry.set(countryId, countryBals);
    }
    const countryBals = byCountry.get(countryId)!;
    for (const c of COMMODITY_TYPES) {
      const stateBal = stateMap.get(c)!;
      const countryBal = countryBals.get(c)!;
      countryBal.supply += stateBal.supply;
      countryBal.demand += stateBal.demand;
    }
  }

  // ── Government spending → commodity demand ───────────────────────────────
  // National budgets add demand globally and per country so national S/D matches
  // macro for state price regional legs and nationalPrices.
  // Spending is stored in local currency — divide by FX rate to normalize to ₳
  // before computing units, so JPY-denominated budgets don't dwarf USD/GBP ones.
  // fxRateForCountry is declared earlier (at the sector / marketing normalization
  // block) and reused here.
  //
  // healthcare was the only channel here for a long time; defense/ordnance was
  // added in #3880, which is why this is now a table rather than one inline loop.
  const GOVT_SPEND_DEMAND: ReadonlyArray<{
    category: string;
    commodity: CommodityType;
    rate: number;
    /** Planned economies only — see STATE_MEDIA_DEMAND_RATE. */
    plannedOnly?: boolean;
  }> = [
    { category: "healthcare", commodity: "healthcare_services", rate: GOVT_HEALTHCARE_DEMAND_RATE },
    { category: "defense", commodity: "ordnance", rate: GOVT_DEFENSE_ORDNANCE_DEMAND_RATE },
    // The buyer for state broadcasting. Bloc media was re-denominated off
    // advertising (applyPlannedEconomyOutputMix); without this leg the glut
    // simply moves into entertainment services instead of clearing.
    {
      category: "education",
      commodity: "entertainment_services",
      rate: STATE_MEDIA_DEMAND_RATE,
      plannedOnly: true,
    },
  ];
  const turnsPerYear = 48;
  for (const { category, commodity, rate, plannedOnly } of GOVT_SPEND_DEMAND) {
    const basePrice = LEDGER_BASE_PRICES[commodity];
    const aliases = GOVT_SPEND_CATEGORY_ALIASES[category] ?? [category];
    for (const budget of federalBudgets) {
      if (
        plannedOnly &&
        !isPlannedEconomy(budget.countryId, ledgerCurrentYear, ledgerCommandEconomyEnabled)
      ) {
        continue;
      }
      const annualSpendLocal = govtSpendForCategory(budget.spending?.byCategory, aliases);
      if (annualSpendLocal <= 0) continue;
      const cid = budget.countryId;
      const annualSpendAnchor = annualSpendLocal / fxRateForCountry(cid);
      const units = (annualSpendAnchor / turnsPerYear / basePrice) * rate;
      if (units <= 0) continue;
      global.get(commodity)!.demand += units;
      if (!cid) continue;
      if (!byCountry.has(cid)) {
        const countryBals = new Map<CommodityType, { supply: number; demand: number }>();
        for (const c of COMMODITY_TYPES) countryBals.set(c, { supply: 0, demand: 0 });
        byCountry.set(cid, countryBals);
      }
      byCountry.get(cid)!.get(commodity)!.demand += units;
    }
  }

  // ── Inter-country trade clearing + whole-market dampened convergence ──────
  // Clear surpluses against deficits (on the REAL balances) to produce directed
  // flows, then relieve each country's effective supply/demand by k× the trade
  // it did. The mutation lands on `byCountry` BEFORE prices are computed, so the
  // relief propagates whole-market: commodity prices, the stored national S/D,
  // sector margins (next turn), and inflation cost-push all see the post-trade
  // balances. k=0 is an exact no-op. `tradeClearing` (units) is reused to value
  // the flow snapshot after prices are known. k validated against live data
  // (turn 414): k=0.5 → ≤19% price shift, nothing past the soft-knee.
  // Influence levers (Phase 6a): FTA coverage, shared org-bloc membership, and
  // importer tariffs shape the clearing affinity; active embargoes block/cap
  // specific flows. Loaded here (separate from the main parallel block to keep
  // the positional test fetches stable).
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
  const blocsByCountry = new Map<string, Set<string>>();
  for (const m of orgMembershipDocs) {
    if (!m.countryId || !m.organizationId) continue;
    if (!blocsByCountry.has(m.countryId)) blocsByCountry.set(m.countryId, new Set());
    blocsByCountry.get(m.countryId)!.add(String(m.organizationId));
  }
  const { affinityFor, capUnitsFor } = buildTradeAffinity({
    ftaPairs,
    blocsByCountry,
    tariffs: tariffDocs,
    embargoes: embargoDocs,
  });

  // Build existing price map early: the sourcing pass uses LAST turn's stored
  // prices as fixed asks, and the drift baseline below reuses the same map.
  const existingPriceMap = new Map<string, CommodityPrice>(
    existingPrices.map((p) => [p.commodity, p])
  );

  // Freight is a separately-soaked rollout.  The market ladder enables the
  // ledger needed to observe routes, while this gate decides whether those
  // deliveries constrain next turn's local plant inputs.
  const freightSettlementConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { freightSettlementMode: 1 } });
  const freightSettlementActive =
    freightSettlementConfig?.freightSettlementMode === "active" &&
    marketAtLeast(marketSystemMode, "clearing");
  let freightSettlement: FreightSettlement | null = null;

  // ── Landed-price freight settlement (shadow or active) ──
  // Runs on PRE-clearing balances, preserving those raw balances for aggregate
  // clearing. It determines which sellers each state can buy from at landed
  // price (ask + per-hop freight + tariff), bounded by origin freight capacity.
  // Shadow persists routes only. Active additionally persists delivered input
  // availability for the following corporation turn. Ordering constraint: stay
  // above clearAllCommodities/applyTradeConvergence, which relieve byCountry
  // in place.
  if (marketAtLeast(marketSystemMode, "ledger")) {
    const sourcingStates = allStates
      .filter((s) => !NATIONAL_SCOPE_IDS.has(s._id) && stateToCountry.has(s._id))
      .map((s) => ({ stateId: s._id, countryId: s.countryId as CountryId }));
    freightSettlement = settleFreightNetwork({
      states: sourcingStates,
      byState,
      byCountry,
      statePricesFor: (commodity) => existingPriceMap.get(commodity)?.statePrices,
      nationalPricesFor: (commodity) => existingPriceMap.get(commodity)?.nationalPrices,
      basePriceFor: (commodity) => LEDGER_BASE_PRICES[commodity],
      freightPrice: existingPriceMap.get("freight")?.globalPrice ?? LEDGER_BASE_PRICES.freight,
      eraUnitScale: ledgerEraUnitScale,
      hops: stateHops,
      shippingCostMultiplier: (_country, from, to) => {
        const average =
          ((roadConditionByState.get(from) ?? 60) + (roadConditionByState.get(to) ?? 60)) / 2;
        return Math.max(0.97, Math.min(1.03, 1 - ((average - 60) / 40) * 0.03));
      },
      tariffRatePct: (commodity, exporter, importer) => {
        const sectorType = PRIMARY_SECTOR_BY_COMMODITY[commodity];
        return sectorType
          ? importerTariffOnFlow(tariffDocs, ftaPairs, importer, exporter, sectorType)
          : 0;
      },
      // affinity 0 ⇔ a blocking embargo matches the directed flow.
      isBlocked: (commodity, exporter, importer) =>
        affinityFor(commodity, exporter, importer) === 0,
    });
    const { commodityDocs, networkDoc } = buildSourcingDocs(freightSettlement.sourcing, turn, now);
    if (commodityDocs.length > 0) {
      // Lazy index for the {commodity} + latest-turn read path, mirroring
      // commodityFlows. Fire-and-forget.
      void db
        .collection("commoditySourcingFlows")
        .createIndex({ commodity: 1, turn: -1 })
        .catch(() => {});
      // Upsert by {commodity, turn} so cron retries overwrite rather than append.
      await db.collection("commoditySourcingFlows").bulkWrite(
        commodityDocs.map((doc) => ({
          replaceOne: {
            filter: { commodity: doc.commodity, turn: doc.turn },
            replacement: doc,
            upsert: true,
          },
        }))
      );
    }
    await db
      .collection("sourcingNetworkLoad")
      .updateOne({ turn }, { $set: networkDoc }, { upsert: true });
    const sourcingPruneCutoff = turn - SOURCING_FLOW_RETENTION_TURNS;
    if (sourcingPruneCutoff > 0) {
      await Promise.all([
        db.collection("commoditySourcingFlows").deleteMany({ turn: { $lt: sourcingPruneCutoff } }),
        db.collection("sourcingNetworkLoad").deleteMany({ turn: { $lt: sourcingPruneCutoff } }),
      ]);
    }

    // Freight demand wiring (ticket #1039): haul TEU is booked as real freight
    // demand before clearing, so the Logistics map and sold % read one market.
    applyFreightHaulDemand(freightSettlement.sourcing.freightTeuByState, {
      global,
      byState,
      byCountry,
      stateToCountry,
    });
  }

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
    isBlocked: (commodity, exporter, importer) => affinityFor(commodity, exporter, importer) === 0,
  });
  applyTradeConvergence(COUNTRY_ORDER, byCountry, tradeClearing, TRADE_PRICE_CONVERGENCE_K);

  // Build nudge map from the parallel-fetched nudge docs
  const nudgeMap = new Map<string, number>(
    nudgeDocs
      .filter((d): d is typeof d & { nudgePrice: number } => d.nudgePrice != null)
      .map((d) => [d.commodity, d.nudgePrice])
  );

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

  // ── Era-aware demand calibration ───────────────────────────────────────────
  // Applied once, after every demand generator has contributed and before any
  // price is computed, so the global, national and regional legs and the
  // commodityFlows record all see the same corrected figure. Inert (1.0) for
  // every era except 1953 — see commodityDemandCalibration.ts for why the
  // money-to-units generators are era-sensitive.
  const calibrationEra = eraForPreset(activePreset);
  for (const commodity of COMMODITY_TYPES) {
    const mult = commodityDemandCalibration(calibrationEra, commodity);
    if (mult === 1) continue;
    const g = global.get(commodity);
    if (g) g.demand *= mult;
    for (const byCommodity of byCountry.values()) {
      const bal = byCommodity.get(commodity);
      if (bal) bal.demand *= mult;
    }
    for (const byCommodity of byState.values()) {
      const bal = byCommodity.get(commodity);
      if (bal) bal.demand *= mult;
    }
  }

  for (const commodity of COMMODITY_TYPES) {
    const basePrice = LEDGER_BASE_PRICES[commodity];
    const globalBal = global.get(commodity)!;
    const existing = existingPriceMap.get(commodity);

    // Scarcity drift: advance this commodity's multiplier on the CURRENT
    // aggregate balance, then scale the base price so the global, national
    // and state legs (and the price/base realization ratio) all inherit the
    // scarcity memory consistently. Pegs/nudges still take precedence below.
    const scarcityMult = scarcityDriftEnabled
      ? updateScarcityMultiplier(existing?.scarcityMult, globalBal.supply, globalBal.demand)
      : 1;
    scarcityMultByCommodity.set(commodity, scarcityMult);
    const effBasePrice = Math.round(basePrice * scarcityMult * 100) / 100;
    const priceKnee = getPriceSoftKnee(commodity);

    // ── Global price with drift + peg/nudge precedence ──
    let globalMktPrice: number;
    if (existing?.hardPeg != null) {
      globalMktPrice = existing.hardPeg;
    } else if (nudgeMap.has(commodity)) {
      globalMktPrice = nudgeMap.get(commodity)!;
    } else {
      const targetPrice = computeMarketPrice(
        effBasePrice,
        globalBal.supply,
        globalBal.demand,
        priceKnee
      );
      const previousPrice = existing?.globalPrice ?? targetPrice;
      globalMktPrice =
        Math.round(
          (previousPrice + COMMODITY_PRICE_DRIFT_RATE * (targetPrice - previousPrice)) * 100
        ) / 100;
    }

    appliedGlobalPrices.set(commodity, globalMktPrice);

    // ── National prices per country ───────────────────────────────────────
    // Computed before state prices because the state-leg blend uses the
    // country's national price as one of its three legs.
    const nationalPrices: Record<string, number> = {};
    const nationalSupply: Record<string, number> = {};
    const nationalDemand: Record<string, number> = {};
    for (const [countryId, countryBals] of byCountry) {
      const bal = countryBals.get(commodity)!;
      // NATIONAL_COMMODITY_STABILIZER floors both sides so countries with minimal
      // sector activity don't produce degenerate ratios (same role as STATE_COMMODITY_SUPPLY_DEMAND).
      const marketNationalPrice = computeMarketPrice(
        effBasePrice,
        bal.supply + NATIONAL_COMMODITY_STABILIZER,
        bal.demand + NATIONAL_COMMODITY_STABILIZER,
        priceKnee
      );
      // Planned economies: the national price is ADMINISTERED (held at the era
      // base + turnover-tax wedge, no S/D response). Dual-track economies blend
      // administered and market by the dial's plannedShare. Fully country-scoped
      // — the market global/regional legs are untouched. Off / market → market.
      if (
        commandEconomyEnabled &&
        isPlannedEconomy(countryId, priceCurrentYear, commandEconomyEnabled)
      ) {
        const administered = administeredNationalPrice(effBasePrice);
        const share = plannedShare(countryId, priceCurrentYear, commandEconomyEnabled);
        nationalPrices[countryId] = dualTrackPrice(administered, marketNationalPrice, share);
      } else {
        nationalPrices[countryId] = marketNationalPrice;
      }
      nationalSupply[countryId] = Math.round(bal.supply * 100) / 100;
      nationalDemand[countryId] = Math.round(bal.demand * 100) / 100;
    }
    appliedNationalPrices.set(commodity, nationalPrices);

    // Macro-driven commodities have meaningless state-level S/D; the regional
    // leg falls through to national, making the effective blend 50/50.
    const isMacroPriceBlend = COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND.has(commodity);

    const statePrices: Record<string, number> = {};
    // Reference captured after loop populates it — stored for history snapshots
    appliedStatePrices.set(commodity, statePrices);
    const stateSupply: Record<string, number> = {};
    const stateDemand: Record<string, number> = {};

    // Write a state price for every state. Even states with no local activity
    // get a composite price so the regional map can always render a full view.
    for (const state of allStates) {
      if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
      const stateId = state._id;
      const stateBal = byState.get(stateId)?.get(commodity) ?? { supply: 0, demand: 0 };
      if (stateBal.supply > 0 || stateBal.demand > 0) {
        statesWithActivity.add(stateId);
      }

      // ── State price with drift + peg/nudge precedence ──
      // Precedence: state peg > state nudge > global peg > global nudge > drift
      let statePrice: number;
      if (existing?.stateHardPegs?.[stateId] != null) {
        statePrice = existing.stateHardPegs[stateId];
      } else if (existing?.stateNudges?.[stateId] != null) {
        statePrice = existing.stateNudges[stateId];
      } else if (existing?.hardPeg != null) {
        statePrice = existing.hardPeg;
      } else if (nudgeMap.has(commodity)) {
        statePrice = nudgeMap.get(commodity)!;
      } else {
        // Three-leg blend: 50% global + 25% national + 25% regional (state).
        // For macro-driven commodities the regional leg redirects to national.
        const countryId = stateToCountry.get(stateId);
        const nationalLeg =
          countryId && nationalPrices[countryId] != null
            ? nationalPrices[countryId]
            : globalMktPrice;
        const deliveredSupply = freightSettlementActive
          ? (freightSettlement?.deliveredSupplyByCommodity.get(commodity)?.get(stateId) ??
            stateBal.supply)
          : stateBal.supply;
        const regionalLeg = isMacroPriceBlend
          ? nationalLeg
          : computeMarketPrice(effBasePrice, deliveredSupply, stateBal.demand, priceKnee);
        const targetPrice = blendPrice(globalMktPrice, nationalLeg, regionalLeg);
        const previousPrice = existing?.statePrices?.[stateId] ?? targetPrice;
        statePrice =
          Math.round(
            (previousPrice + COMMODITY_PRICE_DRIFT_RATE * (targetPrice - previousPrice)) * 100
          ) / 100;
      }

      statePrices[stateId] = statePrice;
      stateSupply[stateId] = Math.round(stateBal.supply * 100) / 100;
      stateDemand[stateId] = Math.round(stateBal.demand * 100) / 100;
    }

    const deliveredSupply = freightSettlementActive
      ? Object.fromEntries(
          freightSettlement?.deliveredSupplyByCommodity.get(commodity)?.entries() ?? []
        )
      : undefined;
    const inputAvailability = freightSettlementActive
      ? Object.fromEntries(
          freightSettlement?.inputAvailabilityByCommodity.get(commodity)?.entries() ?? []
        )
      : undefined;

    ops.push({
      updateOne: {
        filter: { commodity },
        update: {
          $set: {
            basePrice,
            globalPrice: globalMktPrice,
            globalSupply: Math.round(globalBal.supply * 100) / 100,
            globalDemand: Math.round(globalBal.demand * 100) / 100,
            statePrices,
            stateSupply,
            stateDemand,
            ...(deliveredSupply ? { stateDeliveredSupply: deliveredSupply } : {}),
            ...(inputAvailability ? { stateInputAvailability: inputAvailability } : {}),
            nationalPrices,
            nationalSupply,
            nationalDemand,
            turn,
            // Clear consumed nudges — pegs are preserved (not included in $set)
            nudgePrice: null,
            nudgeTurn: null,
            stateNudges: {},
            scarcityMult,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    await db.collection("commodityPrices").bulkWrite(ops);
  }

  // Store price history snapshots for charting — uses the actual applied price
  // (including drift, pegs, and nudges) so charts match what players see.
  const historyDocs = COMMODITY_TYPES.map((commodity) => {
    const globalBal = global.get(commodity)!;
    return {
      commodity,
      turn,
      globalPrice:
        appliedGlobalPrices.get(commodity) ??
        computeMarketPrice(LEDGER_BASE_PRICES[commodity], globalBal.supply, globalBal.demand),
      globalSupply: Math.round(globalBal.supply * 100) / 100,
      globalDemand: Math.round(globalBal.demand * 100) / 100,
      statePrices: appliedStatePrices.get(commodity) ?? {},
      nationalPrices: appliedNationalPrices.get(commodity) ?? {},
      scarcityMult: scarcityMultByCommodity.get(commodity) ?? 1,
      createdAt: now,
    };
  });
  // Upsert by {commodity, turn} so cron retries overwrite rather than append.
  if (historyDocs.length > 0) {
    await db.collection("commodityPriceHistory").bulkWrite(
      historyDocs.map((doc) => ({
        replaceOne: {
          filter: { commodity: doc.commodity, turn: doc.turn },
          replacement: doc,
          upsert: true,
        },
      }))
    );
  }

  // Prune history older than 5 game years (240 turns) to cap storage
  const pruneCutoff = turn - 240;
  if (pruneCutoff > 0) {
    await db.collection("commodityPriceHistory").deleteMany({ turn: { $lt: pruneCutoff } });
  }

  // ── Commodity flow ledger (marketSystemMode >= "ledger", audit t806 Fix 3/D0) ──
  // Shadow of the flows the current model implies: units supplied/demanded,
  // what would clear, unmet demand and unsold surplus, globally and per
  // country. Pure observability — no behaviour change; later ledger phases
  // (inventory, throughput coupling) build on these rows.
  if (marketAtLeast(marketSystemMode, "ledger")) {
    // Prior turn's stock rows seed this turn's inventory accumulation.
    const prevFlows = await db
      .collection("commodityFlows")
      .find({ turn: turn - 1 }, { projection: { commodity: 1, stockUnits: 1 } })
      .toArray();
    const prevStockByCommodity = new Map<CommodityType, number>(
      prevFlows
        .filter((f) => typeof f.stockUnits === "number")
        .map((f) => [f.commodity as CommodityType, f.stockUnits as number])
    );
    const flowDocs = buildCommodityFlowDocs({
      global,
      byCountry,
      globalPriceByCommodity: appliedGlobalPrices,
      nationalPricesByCommodity: appliedNationalPrices,
      prevStockByCommodity,
      coverCapEnabled: stockCoverCapEnabled,
      plantsUnitsByCommodity: plantsLedgerEnabled ? plantsUnitsByCommodity : undefined,
      turn,
      now,
    });
    if (flowDocs.length > 0) {
      // Lazy index for the {commodity} + latest-turn read path (commodity page)
      // and the upsert filter below. Fire-and-forget, same as wireEvent.
      void db
        .collection("commodityFlows")
        .createIndex({ commodity: 1, turn: -1 })
        .catch(() => {});
      // Upsert by {commodity, turn} so cron retries overwrite rather than append.
      await db.collection("commodityFlows").bulkWrite(
        flowDocs.map((doc) => ({
          replaceOne: {
            filter: { commodity: doc.commodity, turn: doc.turn },
            replacement: doc,
            upsert: true,
          },
        }))
      );
    }
    const flowPruneCutoff = turn - COMMODITY_FLOW_RETENTION_TURNS;
    if (flowPruneCutoff > 0) {
      await db.collection("commodityFlows").deleteMany({ turn: { $lt: flowPruneCutoff } });
    }
  }

  // Value the trade flows (computed before pricing, above) at the national
  // prices just produced, and persist the per-turn snapshot.
  const tradeSnapshot = valueTradeSnapshot(
    COUNTRY_ORDER,
    tradeClearing,
    appliedNationalPrices,
    appliedGlobalPrices,
    turn,
    now
  );
  // Read path for the reachable books is "latest turn that has them", so the
  // descending-turn index is what keeps it O(1) as the snapshot history grows.
  // Fire-and-forget, mirroring commodityFlows/commoditySourcingFlows above.
  void db
    .collection("tradeFlowSnapshots")
    .createIndex({ turn: -1 })
    .catch(() => {});
  await db
    .collection("tradeFlowSnapshots")
    .updateOne(
      { turn },
      { $set: { ...tradeSnapshot, books: serializeReachableBooks(reachableBooks) } },
      { upsert: true }
    );

  return {
    commoditiesUpdated: COMMODITY_TYPES.length,
    statesWithActivity: statesWithActivity.size,
    tradeClearedVolume: tradeSnapshot.world.clearedVolume,
  };
}
