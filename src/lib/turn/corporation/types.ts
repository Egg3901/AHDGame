import type { ObjectId, AnyBulkWriteOperation } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  FederalBudget,
  Bond,
  Tariff,
  Subsidy,
} from "@/lib/db/types";
import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import type { StateSectorSpecialization } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CrossCorpStockHolding } from "@/lib/corporations/portfolioAnchorValuation";
import type { FtaCoverage } from "@/lib/tariffs/ftaOverrides";

/**
 * All data pre-fetched from the DB and converted into lookup structures.
 * Built once per turn by buildCorporationLookups, consumed by processSectors
 * and other phases — avoids redundant DB reads.
 */
export interface CorporationLookups {
  corporations: Corporation[];
  sectorsByCorp: Map<string, CorporateSector[]>;
  corpById: Map<string, Corporation>;
  /**
   * Corporate-presence suppression from TOTAL embargoes. A full "all commodities,
   * block" embargo by country S against country T means T-national corporations
   * may not operate in S: their sectors physically located in S are suspended
   * (revenue frozen, no income) while the embargo is active. Keys are
   * `"${operatingCountryId}|${corpNationalityId}"`. Absent ⇒ no suppression.
   */
  corporateEmbargoSuppression?: Set<string>;
  /**
   * Trade-exposure embargo model gate (gameState.embargoTradeExposureEnabled).
   * When true, a suppressed foreign sector loses only its export-exposed revenue
   * (domestic host sales continue) instead of a total mothball. Default false.
   */
  embargoTradeExposureEnabled?: boolean;
  /**
   * Per-corp player-CEO Business Acumen stat, keyed by corp id. Feeds the
   * growth-cost discount and prime-rate dampening in `calculateDailyGrowthCost` —
   * a skilled CEO grows more cheaply and shrugs off high rates. Absent entries
   * (NPP / imperial / vacant CEO, or unmigrated character) are treated as neutral.
   */
  ceoBusinessAcumenByCorpId: Map<string, number>;
  bondsByCorpId: Map<string, Bond[]>;
  /** Corporate bonds held by each corporation (holder corp id → positions). */
  bondsHeldByCorpId: Map<string, { bond: Bond; units: number }[]>;
  /**
   * Mark-to-market portfolio per corp (₳ anchor): held bonds, stock in other corps,
   * IMF facility receivable principal. Matches balance sheet components used on GET
   * /api/corporations/[id] so share price tracks holding-company assets.
   */
  portfolioAnchorValueByCorpId: Map<string, number>;
  /** Bonds + IMF receivable only (₳ anchor) — excludes cross-corp stock for iterative pricing. */
  bondAndImfPortfolioAnchorByCorpId: Map<string, number>;
  /**
   * Sum of `totalIssued` for each corp's active (non-defaulted) corporate bonds.
   * Subtracted from balance-sheet equity in the share-price formula so issuing
   * a bond is neutral on share price (cash inflow offset by debt liability).
   *
   * Natcorps (`countryOwnerId` set) are excluded from this map — their bond
   * interest is already government-subsidized (`perTurnBondDragOnNetIncome = 0`)
   * and the principal is treated as sovereign-backed. Subtracting principal
   * while waiving interest would be internally inconsistent.
   *
   * Defaulted bonds are excluded — they no longer represent a payable
   * obligation in this game's settlement model.
   */
  issuedBondDebtByCorpId: Map<string, number>;
  /** Corp-to-corp equity stakes (holder → list of issuers). */
  crossCorpStockHoldingsByHolderCorpId: Map<string, CrossCorpStockHolding[]>;
  primeRateByCountry: Map<string, number>;
  // Macro modifiers derived from federal budgets
  macroInflationByCountry: Map<string, number>;
  /** Per-country investor confidence (spec §12.4 feed 1). Absent ⇒ baseline. */
  investorConfidenceByCountry: Map<string, number>;
  /** Per-country State Ownership Concentration Index (SOCI, 0–100). Absent ⇒ 0.
   *  Optional — consumers use `?.get` and treat absence as 0 (no escalation). */
  stateOwnershipConcentrationByCountry?: Map<string, number>;
  /** §6.2 (P7b): per-country LAGGED economic model, for the corp alignment margin modifier.
   *  Optional — consumers use `?.get` and treat absence as no alignment (parity). */
  economicModelByCountry?: Map<string, import("@/lib/constants/economicModels").EconomicModelState>;
  macroDebtToGdpByCountry: Map<string, number>;
  macroDeficitByCountry: Map<string, number>;
  /**
   * Per-corp sector margin penalty contribution from sovereign defaults
   * (local + global contagion layers). Built once per turn from the set of
   * countries currently in `recovering` state. See sovereign-default design
   * Section 5.3.
   */
  sovereignDefaultMarginByCorpId: Map<string, number>;
  // State-level margin modifiers derived from stateMetrics
  stateMetricsByState?: Map<string, import("@/lib/db/types").StateMetrics>;
  /**
   * SP4 §4a: per-region political margin overlays for LAW_COUNTRY_IDS regions
   * (marginAdapter.buildPoliticalBaseModifiers over each politicalMetrics doc).
   * Absent for non-playable regions.
   */
  politicalBaseModifiersByState?: Map<string, Map<string, { modifier: number; rawValue: number }>>;
  /**
   * SP4: raw political boards per playable region — feeds the raw-value reads
   * demolition removed from stateMetrics (workforce skill for worker counts,
   * SOE governance inputs). Absent for non-playable regions.
   */
  politicalBoardByState?: Map<
    string,
    Record<import("@/lib/politicalMetrics/types").PoliticalMetricId, number>
  >;
  unemploymentByState: Map<string, number>;
  gridReliabilityByState: Map<string, number>;
  corruptionByState: Map<string, number>;
  workforceSkillByState: Map<string, number>;
  rawWorkforceSkillByState: Map<string, number>;
  crimeRateByState: Map<string, number>;
  broadbandByState: Map<string, number>;
  roadConditionByState: Map<string, number>;
  carbonEmissionsByState: Map<string, number>;
  costOfLivingByState: Map<string, number>;
  // Commodity supply/demand data for margin calculation
  globalCommodityBalances: Map<CommodityType, { supply: number; demand: number }>;
  /**
   * Lagged global price / base price per commodity (prior turn's computed
   * price). Read by the price-realization multiplier when
   * marketSystemMode >= "realization"; always built (cheap), inert otherwise.
   */
  priceRatioByCommodity: Map<CommodityType, number>;
  /**
   * Money wiring (interstate-logistics plan step 5, phase A): per state, per
   * commodity, last turn's landed-price premium per unit (₳) for out-of-state
   * sourcing, read from the prior sourcingNetworkLoad doc. Empty when
   * `interstateMoneyWiringEnabled` is off or no doc exists yet - computeInputsCost
   * treats an absent/empty lookup as "no premium", matching pre-money-wiring
   * behavior exactly.
   */
  landedPremiumByState?: Map<string, Map<CommodityType, number>>;
  nationalCommodityBalancesByCountry: Map<
    string,
    Map<CommodityType, { supply: number; demand: number }>
  >;
  /**
   * Market partition (era worlds only, null on modern worlds): per-country
   * reachable clearing books — supply = the country's lagged national supply,
   * demand = domestic demand net of import competition plus the exports the
   * trade graph (embargoes/tariffs/caps) lets the country place abroad. When
   * present, the clearing pass runs one book per seller home country instead
   * of a single worldwide book. See market/tradePartition.ts.
   */
  countryClearingBooks: Map<
    CountryId,
    Map<CommodityType, { supply: number; demand: number }>
  > | null;
  rawStateBalances: Map<string, Map<CommodityType, { supply: number; demand: number }>>;
  /** Per-country export intensity ∈ [0,1] per commodity (from the latest trade
   *  snapshot) — fraction of the country's surplus that cleared abroad. Feeds
   *  the export-reward margin premium. Empty before the first trade turn. */
  exportIntensityByCountry: Map<string, Map<CommodityType, number>>;
  sectorPresenceKeys: Set<string>;
  // Trade policy
  allTariffs: Tariff[];
  /** Active free-trade agreement country pairs ("A|B", sorted). Tariff lookups
   * short-circuit to 0 when a pair is present — see ftaOverrides.ts. */
  activeFtaPairs: ReadonlySet<string>;
  /** Per-layer FTA coverage shares used by getDomesticTariffMalus and
   *  getTariffBlendWeights. Pre-computed once per turn in buildLookups. */
  ftaCoverage: FtaCoverage;
  activeSubsidies: Subsidy[];
  // Kept here so the orchestrator can write tax base updates without a second fetch
  federalBudgets: FederalBudget[];
  // Corporate tax rates by country for per-sector federal tax (domestic vs foreign corp).
  // Domestic = corp.countryId === sector.countryId; foreign = everything else.
  domesticCorpTaxRateByCountry: Map<string, number>;
  foreignCorpTaxRateByCountry: Map<string, number>;
  // Corporate tax rates by state for per-sector state tax (domestic vs foreign corp).
  domesticStateCorpTaxRateByState: Map<string, number>;
  foreignStateCorpTaxRateByState: Map<string, number>;
  // FX rates (local per 1 ₳ internal unit). Used by share-price to bring ₳-denominated
  // income/NPV into the same currency as corp.liquidCapital (migrated to local on forex enable).
  exchangeRatesByCurrency: Map<CurrencyCode, number>;
  // stateId → countryId. Used to convert per-state income contributions into the correct
  // local currency before blending into state budget tax bases (Gap C fix).
  stateCountryMap: Map<string, string>;
  // stateId → resource capacities. Absence (.get() === undefined) means the
  // state has no capacity doc = uncapped (legacy/pre-migration). Used by
  // extraction sector processing to zero out supply contributions for
  // resources the state has none of, and by R&D innovation to target states
  // that actually track capacity.
  stateResourceCapacityByState: Map<string, Partial<Record<ExtractableResource, number>>>;
  /**
   * sectorId → revenue-weighted extraction capacity utilization (0..1) and the
   * most-binding resource, derived from computeExtractionCapacityMultipliers.
   * Drives the capacity revenue haircut in processSectors. Computed here (not in
   * commodityPriceTurn, which runs after the corp phase) so it is available
   * while sector income is calculated. Empty when there are no extraction
   * sectors; a missing entry means unconstrained (utilization 1).
   */
  extractionCapacityUtilBySector: Map<
    string,
    { utilization: number; bindingResource: ExtractableResource | null }
  >;
  /**
   * sectorId → market-share percent (0–100) within its (state, sectorType).
   * Drives the dominance multiplier applied in `calculateDailyGrowthCost`.
   * Sectors missing from the map (e.g. orphaned by missing state doc) skip
   * the dominance penalty rather than charging an extreme cost on bad data.
   */
  marketShareBySectorId: Map<string, number>;
  /**
   * sectorId -> the owning corp's NATIONAL share of its (countryId, sectorType),
   * summed across every state. Dominance tolls charge on max(local, national) so
   * a champion cannot dodge antitrust by spreading thin across regions. Optional:
   * absent (older fixtures / callers) reduces the toll to the local share alone.
   */
  nationalDominanceShareBySectorId?: Map<string, number>;
  /** stateId -> primary/secondary sector margin specialization. */
  stateSectorSpecializationByState: Map<string, StateSectorSpecialization>;
  /** Active auto-disaster decay margin effects, indexed by affected stateId. */
  activeDisasterEffectsByState: Map<
    string,
    import("@/lib/crises/disasterMarginPenalty").DisasterEffectEntry[]
  >;
  /** Named regional conditions (approval modifiers) stacked into sector margins. */
  regionalConditionMarginByState?: Map<string, number>;
  /** Live era year (null while eraSystemEnabled is off) — gates inactive metric margin signals. */
  eraYear?: number | null;
  /**
   * The world's era unit-basis scale (`getEraUnitScale(preset)`): 1 for modern
   * worlds, ~70 for 1953. Every ₳↔capacity-unit conversion in the turn MUST use
   * this one value — mixing scaled and unscaled conversions drifts the stored
   * (revenue, units) pairs by the era ratio.
   */
  eraUnitScale: number;
}

/** Named type for the anonymous snapshot object that was inline in the original function. */
export interface CorpSnapshot {
  corpId: ObjectId;
  revenue: number;
  totalCosts: number;
  /** Pre-tax operating income minus overhead, before bond flows and dividends (₳/turn). */
  incomePreDividends: number;
  income: number;
  /** Coupon income earned as a bond holder this turn (₳/turn). */
  perTurnBondCouponIncome: number;
  /** Gross bond coupon expense on issued bonds this turn (₳/turn). */
  perTurnBondInterestExpense: number;
  /** Bond interest expense this turn — zero for national enterprises (₳/turn). */
  perTurnBondDragOnNetIncome: number;
  /** liquidCapital normalized to ₳ at turn start plus per-turn `income` (also ₳). Used for iterative cross-holding pricing. */
  liquidCapitalAnchorAfterIncome: number;
  /** Total dividend paid to all shareholders this turn. */
  dividendPaidPerTurn: number;
  federalTaxPaid: number;
  stateTaxPaid: number;
  /** Per-country federal tax paid (₳/turn). Empty map for single-country corps. */
  taxPaidByCountry: Map<string, number>;
  /** Per-state/region state tax paid (₳/turn). Empty map for single-state corps. */
  taxPaidByState: Map<string, number>;
  /** Domestic/foreign split of taxPaidByCountry — same sum, split by corp.countryId === s.countryId. */
  taxPaidByCountryDomestic: Map<string, number>;
  taxPaidByCountryForeign: Map<string, number>;
  /** Domestic/foreign split of taxPaidByState. */
  taxPaidByStateDomestic: Map<string, number>;
  taxPaidByStateForeign: Map<string, number>;
  marketingStrength: number;
  logisticsStrength: number;
  rdScore: number;
  dividendRate: number;
  liquidCapital: number;
  /** Local-currency amount swept treasury → escrow this turn (0 unless escrow mode). */
  escrowFundingMove: number;
  /** Escrow balance after this turn's funding sweep, local currency. */
  escrowBalanceAfter: number;
  actualSharePrice: number;
  totalShares: number;
  sectorNPV: number;
  creditComposite: number;
  creditRating: string;
  /** Diagnostic margin data for debugging cost/revenue spikes */
  marginDiagnostic?: {
    effectiveMargin: number;
    commodityInputMod: number;
    commoditySurplusMod: number;
    exportPremiumMod: number;
    macroMod: number;
    stateMetricsMod: number;
    legacyStateMetricsMod?: number;
    growthCostRatio: number;
    sectorCount: number;
  };
}

/** Constituent-corp dividend owed to an index fund (cap-table `fundId`), in ₳. */
export interface FundDividendAccrual {
  fundId: ObjectId;
  corporationId: ObjectId;
  shares: number;
  amountAnchor: number;
}

/**
 * Sector bulk update emitted by the sector loop — always a single updateOne
 * with a `$set`, keyed by sector _id. Narrower than AnyBulkWriteOperation so
 * consumers (and tests) can read `op.updateOne` without union narrowing.
 */
export interface SectorUpdateOp {
  updateOne: {
    filter: { _id: ObjectId };
    /**
     * C4: not just `$set`. The turn's build-queue write is a `$pull` of the
     * orders that landed plus an `$inc` of the CIP they held, so that an order
     * a CEO places DURING the sector-compute phase survives the end-of-turn
     * bulkWrite instead of being erased by a whole-array `$set` from a stale
     * snapshot. The flip-turn growth credit is a `$push` in its own op.
     */
    update: {
      $set?: Record<string, unknown>;
      $pull?: Record<string, unknown>;
      $inc?: Record<string, number>;
      $push?: Record<string, unknown>;
    };
  };
}

/** Everything the sector-processing loop produces for downstream phases. */
export interface SectorCalculationsResult {
  sectorOps: SectorUpdateOp[];
  corpOps: AnyBulkWriteOperation<Corporation>[];
  corpSnapshots: CorpSnapshot[];
  ceoSalaryPayments: Map<string, Map<CurrencyCode, number>>;
  dividendPayments: Map<string, Map<CurrencyCode, number>>;
  /** Dividends owed to corporate shareholders, amounts in ₳ (internal) — convert to treasury currency when applying. */
  corpDividendPaymentsAnchorByCorpId: Map<string, number>;
  /** Same dividends split by the PAYING corp's currency (recipientId → payerCcy → ₳), for cross-currency FX spread. */
  corpDividendPaymentsAnchorByCorpCurrency: Map<string, Map<CurrencyCode, number>>;
  /** FX spreads skimmed from foreign operating income, denominated in the source currency, to route to the CB system. */
  sectorFxSpreadFees: Array<{ fromCurrency: CurrencyCode; toCurrency: CurrencyCode; fee: number }>;
  /** Dividends owed to index-fund holders (fundId on cap table), in ₳. */
  fundDividendAccruals: FundDividendAccrual[];
  /** Annualized operating income per country, split by corp-vs-sector country match. */
  domesticIncomeByCountry: Map<string, number>;
  foreignIncomeByCountry: Map<string, number>;
  /** Annualized operating income per operating state, split by corp-vs-sector country match. */
  domesticIncomeByOperatingState: Map<string, number>;
  foreignIncomeByOperatingState: Map<string, number>;
  /** O1c: paid growth cost (₳, per turn) summed per operating state. */
  growthInvestmentByOperatingState: Map<string, number>;
  totalRevenueGenerated: number;
  totalIncomeGenerated: number;
  sectorsProcessed: number;
  /**
   * Realized profit margin (net income before dividends ÷ revenue) per corp this
   * turn. Drives how fast a player CEO trains Business Acumen — better-run corps
   * teach more. Absent corps default to 0 (neutral) at the call site.
   */
  profitMarginByCorpId: Map<string, number>;
  /**
   * v2: per-state labour wage index (worker-weighted wage multiplier; 1.0 =
   * baseline). Persisted to macroMetrics.economic.labourWageIndex and read by the
   * macro coupling (migration pull) when labourSystemMode ≥ "macro". Empty when
   * the labour system is off.
   */
  labourWageIndexByState: Map<string, number>;
  /**
   * v2-3b: per-state automation index (worker-weighted laborCostMultiplier;
   * 1.0 = no automation tech, down to 1 − TECH_LABOR_REDUCTION_CAP at full
   * automation). Deliberately SEPARATE from labourWageIndexByState —
   * automation is excluded from the wage index by design (it cuts headcount,
   * not pay; see the comment at its accumulation site). Persisted to
   * macroMetrics.economic.automationIndex and read by the jobs-channel macro
   * coupling (unemployment) when labourSystemMode ≥ "macro". Empty when the
   * labour system is off.
   */
  automationIndexByState: Map<string, number>;
  /**
   * v3 Phase 6: strike trigger/resolution events emitted this turn, for
   * `index.ts` (which owns `db`) to translate into sentiment pulses. Empty
   * when the labour system is off or no sector crossed a strike-state
   * transition this turn.
   */
  strikeEvents: Array<{
    sectorId: string;
    sectorType: string;
    countryId: string;
    event:
      | "started"
      | "resolved_concession"
      | "resolved_waitout"
      | "resolved_banned"
      | "resolved_agreement";
  }>;
  /**
   * Extraction sectors that newly crossed into capacity-bound state this turn
   * (utilization dropped below CAPACITY_BINDING_THRESHOLD after being above it),
   * for index.ts (which owns db + corp ownership) to turn into player
   * notifications. Same "collect during the pure loop, consume after" pattern
   * as strikeEvents.
   */
  capacityBindingEvents: Array<{
    sectorId: string;
    corporationId: string;
    stateId: string;
    bindingResource: ExtractableResource;
    utilization: number;
  }>;
}
