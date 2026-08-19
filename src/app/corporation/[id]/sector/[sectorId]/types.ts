import type { CorporationType } from "@/lib/constants/corporations";
import type { StateMetricMarginContribution } from "@/lib/corporations/stateMetricMarginTypes";

export interface SectorData {
  _id: string;
  stateId: string;
  countryId?: string;
  stateName: string;
  sectorType: CorporationType;
  sectorLabel: string;
  displayName?: string | null;
  /** Target growth rate (% per game year, 48 turns), player-set goal that currentGrowthRate ticks toward */
  targetGrowthRate: number;
  /** Current active growth rate (% per game year, 48 turns), ticks toward targetGrowthRate at ~0.5pp/turn */
  currentGrowthRate: number;
  /** Legacy field for backwards compatibility, use targetGrowthRate/currentGrowthRate */
  growthRate?: number;
  currentGrowthCost: number;
  revenue: number;
  workers: number;
  productionPolicy: number;
  productionPolicyLevel: number;
  /** Labour system: CEO wage-level lever (1.0 = baseline). */
  wageLevel?: number;
  /** Labour system: this sector's pay level relative to the median sector (e.g. 0.55 = 55%). */
  payVsMedian?: number;
  /** Labour system: minimum-wage cost uplift on this sector (0 = floor doesn't bind). */
  minWageUplift?: number;
  /** v3 Phase 5/6: NPC unionization pressure, 0-100. */
  unionization?: number;
  /** v3 Phase 6: whether a strike is currently active on this sector. */
  strikeActive?: boolean;
  /** v3 Phase 7a: turn after which this sector's CEO may attempt another union-busting action, or null. */
  bustingCooldownUntilTurn?: number | null;
  /** v3 Phase 8 (code-review fix #11): a wage demand from an owned union targeting this sector's industry, or null. */
  unionWageDemand?: number | null;
  /** v3 Phase 8: id of the union covering this country's industry, including a vacant union. */
  unionId?: string | null;
  /** Seeded display name of the union covering this country's industry. */
  unionName?: string | null;
  /**
   * Dues v1: the union that actually holds THIS sector's representation, or
   * null when unrepresented. Distinct from `unionId` above, which is the
   * (countryId, sectorType) industry union even when it holds nothing: dues
   * v1 lets several unions exist in one industry, so representation is now a
   * per-sector fact, not implied by the industry match.
   */
  representingUnionId?: string | null;
  representingUnionName?: string | null;
  createdAt: string;
  /** Active for-sale listing, null when not on the secondary market */
  forSale?: {
    listedAt: string;
    /** Asking price in ₳ (anchor) */
    priceAnchor: number;
    /** NPV in ₳ at listing time */
    npvAnchor: number;
  } | null;
}

export interface CorporationRef {
  _id: string;
  sequentialId?: number;
  name: string;
  countryId?: string;
  brandColor?: string;
  logoUrl?: string | null;
  /** Currency code for sector.revenue / maintenance / growthCost / tax (v0.2.6). */
  liquidCurrencyCode?: string;
  /** True when the owning corp is a National Corporation, market actions (attack) are blocked. */
  isStateOwned?: boolean;
  /**
   * R&D score, drives corp-side prospecting success odds/yield
   * (prospectCorpSuccessChance / prospectCorpRdMult). Assumed added to the
   * sector-detail API response alongside the existing labourEnabled-style
   * flags; absent = 0 (25% floor odds).
   */
  rdScore?: number;
}

export interface CeoRef {
  name: string;
  sequentialId?: number;
  avatarUrl?: string;
}

export interface CommodityFlow {
  commodity: string;
  label: string;
  icon: string;
  colors: string;
  unit: string;
  units: number;
  rate: number;
  basePrice: number;
  globalPrice: number;
  nationalPrice: number;
  regionalPrice: number;
  marketPrice: number;
  /**
   * Demand rows only: the per-unit price the engine actually bills for this
   * input (base price through the revenue realization function,
   * clamp(globalRatio^0.5, 0.7, 1.5)). The physical P&L inputs line sums
   * units x this. Absent on supply rows.
   */
  billedUnitPrice?: number;
  /** Weight of this commodity as % of total supply or demand rate */
  weight: number;
  /** This commodity's individual contribution to the margin modifier (in %) */
  priceImpact: number;
  /** demand/supply ratio for inputs. >1 = shortage, null if supply-side or no data */
  shortageRatio?: number | null;
  /**
   * Price realization (marketSystemMode >= "realization"), supply rows only:
   * the per-commodity revenue factor clamp((lagged price/base)^0.5, 0.7, 1.5)
   * and the underlying price-over-base ratio. undefined when the mode is off.
   */
  realizationFactor?: number;
  realizationPriceOverBase?: number;
  /**
   * Throughput coupling (marketSystemMode >= "clearing"), demand rows only:
   * fraction of this input's demand the market can satisfy (0, 1).
   * undefined when the mode is off.
   */
  inputAvailability?: number;
  /**
   * Market clearing (marketSystemMode >= "clearing"), supply rows only: the
   * share of THIS output that actually sold last turn (0, 1). The Pricing
   * panel's headline blends every output together, so this is what tells a
   * multi-output sector which commodity is the one sitting unsold.
   */
  soldFraction?: number;
  /**
   * Extraction sectors only. Ratio of actual to theoretical output (0, 1).
   * 0 = no deposits in this state. undefined = not applicable or uncapped.
   */
  capacityMultiplier?: number;
}

export interface CommoditySupplyDemandBlendPct {
  /** Shares of global / national / regional S&D in commodity margin (−100 to 100 scale weights, sum ~100%) */
  global: number;
  national: number;
  local: number;
}

export interface CommoditiesData {
  supplies: CommodityFlow[];
  demands: CommodityFlow[];
  commodityMarginModifier: number;
  commoditySupplyDemandBlendPct?: CommoditySupplyDemandBlendPct;
  /**
   * Price realization (marketSystemMode >= "realization"): the multiplier
   * applied to this sector's realized revenue. `applied` is last turn's
   * persisted value; `projected` is recomputed from current lagged prices.
   * undefined when the mode is off (no UI shown).
   */
  priceRealization?: {
    applied: number | null;
    projected: number;
  };
  /**
   * Throughput coupling (marketSystemMode >= "clearing"): input-availability
   * throttle on realized output. `applied` is last turn's ramped factor;
   * `projected` is the unramped Leontief minimum from current lagged
   * balances. undefined when the mode is off.
   */
  throughput?: {
    applied: number | null;
    projected: number;
    bindingInput: string | null;
  };
}

/**
 * Posted-price clearing (marketSystemMode >= "clearing"): the CEO's posture
 * plus last turn's clearing telemetry. Present only when the mode is on.
 */
/**
 * Capital tier (marketSystemMode >= "capital"): capacity, utilization and
 * per-unit economics, computed, not stored. Present only when the mode is on.
 */
export interface CapitalData {
  /** Productive capacity, output units/day. */
  stock: number | null;
  /** Output the current revenue base implies at full throughput. */
  impliedUnits: number;
  /** Share of installed capacity currently required by implied output. */
  utilization: number | null;
  /** Capacity sufficiency factor used to gate output: min(1, stock / implied output). */
  capacityCoverage: number | null;
  /** Installed capacity currently required by implied output, units/day. */
  capacityUsed: number | null;
  depreciationPerTurn: number;
  unit: {
    price: number | null;
    labour: number | null;
    inputs: number | null;
    capitalCharge: number | null;
    margin: number | null;
  };
}

export interface PricingData {
  /** CEO-posted posture (−0.2…0.2) or null = automatic. */
  posture: number | null;
  /** Posture actually used last turn (auto sectors included). */
  effectivePosture: number | null;
  /** Share of output that found a buyer last turn. */
  soldFraction: number | null;
  /** Ramped clearing multiplier applied to realized revenue last turn. */
  clearingFactor: number | null;
  /**
   * Corp's established price-identity norm (brand loyalty, Package A). Owner/CEO
   * only, drives the gouging warning. Absent ⇒ feature off or non-owner viewer.
   */
  brandPostureNorm?: number | null;
}

export interface AvailableStrategy {
  id: string;
  name: string;
  description: string;
  /**
   * Extraction only, projected gross ₳/turn under this strategy at current
   * lagged prices, capacity-clamped per resource. null when not applicable
   * (non-extraction sector) or redacted.
   */
  projectedRevenuePerTurn?: number | null;
  /**
   * Percentage points this strategy would move the EFFECTIVE MARGIN by, at
   * today's commodity prices. Computed server-side with the engine's own
   * `computeBlendedMarginModifiers` over the strategy's supply/demand mix, then
   * diffed against the live sector's commodity modifier. Applies to every sector
   * type. null when redacted.
   */
  projectedMarginDelta?: number | null;
  /**
   * Fractional change to REALIZED REVENUE via price realization under this
   * strategy (0.08 = +8%). The revenue half of the trade-off; pair with
   * `projectedMarginDelta` for the whole picture. null when redacted.
   */
  projectedRealizationDelta?: number | null;
  /**
   * Plants tier (D9): retooling re-denominates existing capacity into the new
   * output mix at equal value. This is the ratio the retool applies, and
   * `capacityAfterRetool` is the unit count the sector would hold afterwards.
   * Present in every mode; only the plants layout reads it.
   */
  capacityRescaleRatio?: number;
  capacityAfterRetool?: number | null;
  /** Strategy is gated by decade or an unlocked tech node. */
  locked?: boolean;
  lockReason?: string | null;
  minDecade?: string | null;
}

export interface StrategyData {
  currentStrategyId: string;
  currentStrategyName: string;
  isTransitioning: boolean;
  isReversing: boolean;
  transitionFromStrategyId: string | null;
  transitionStartTurn: number | null;
  transitionProgress: number | null;
  transitionMarginPenalty: number;
  cancelCost: number;
  reversalTurns: number;
  cooldownUntilTurn: number | null;
  cooldownRemaining: number;
  retoolCost: number;
  availableStrategies: AvailableStrategy[];
  currentTurn: number;
}

export interface Margins {
  base: number;
  // Universal modifiers
  unemploymentModifier: number;
  gridReliabilityModifier: number;
  corruptionModifier: number;
  // Sector-type-specific modifiers (null = not applicable)
  workforceSkillModifier: number | null;
  crimeRateModifier: number | null;
  broadbandModifier: number | null;
  roadConditionModifier: number | null;
  carbonEmissionsModifier: number | null;
  costOfLivingModifier: number | null;
  commodityModifier: number;
  homeLocationModifier: number;
  stateSectorSpecializationModifier: number;
  sectorTypeMatchModifier: number;
  sprawlModifier: number;
  inflationModifier: number;
  debtToGdpModifier: number;
  deficitToGdpModifier: number;
  typeSwitchModifier: number;
  strategyTransitionModifier: number;
  /** Tariff penalty for foreign corps operating in this country. 0 for domestic. */
  foreignTariffModifier: number;
  /** Supply-chain friction cost for domestic corps when tariffs are active. 0 for foreign. */
  domesticTariffMalus: number;
  /** Government subsidy bonus (+15pp per qualifying active federal/state program). */
  subsidyModifier: number;
  /** Margin penalty for dominant sectors (>50% market share). 0 to -15pp. */
  dominanceMarginPenalty: number;
  /**
   * Regulatory burden expressed as a margin-pp equivalent for the breakdown UI.
   * The actual deduction is from revenue (not margin) but it costs the corp
   * the same amount, so we surface it alongside the margin modifiers.
   */
  dominanceRegulatoryBurdenPp: number;
  /** Margin penalty for sectors held at productionPolicyLevel < 0 long-term. */
  sustainedNegativeProductionPenalty: number;
  /** Active-crisis margin penalty (decaying disaster/infrastructure effects on
   *  sectors in this state). Negative pp; matches the turn-engine blend. */
  crisisMarginPenalty?: number;
  /** Active crises driving `crisisMarginPenalty`, for linking to the crisis page. */
  activeCrises?: { id: string; name: string }[];
  /** Strategy-aware state metric total. */
  stateMetricsModifier?: number;
  /** Temporary comparison against the previous sparse state metric system. */
  legacyStateMetricsModifier?: number;
  /** Top positive/negative metric contributions behind stateMetricsModifier. */
  stateMetricContributions?: StateMetricMarginContribution[];
  effective: number;
  /** Global / national / regional weighting for commodity margin (matches turn simulation). */
  commoditySupplyDemandBlendPct?: CommoditySupplyDemandBlendPct;
  // Raw metric values for display context
  unemploymentRate: number | null;
  gridReliability: number | null;
  corruptionIndex: number | null;
  workforceSkill: number | null;
  crimeRate: number | null;
  broadbandAccess: number | null;
  roadCondition: number | null;
  carbonEmissions: number | null;
  costOfLiving: number | null;
  inflationRate: number | null;
  debtToGdpRatio: number | null;
  deficitToGdpPct: number | null;
}

export interface Financials {
  revenue: number;
  /** Realized revenue after all realization legs (capacity/clearing/throughput/capital/strike/embargo). */
  realizedRevenue?: number;
  /** True when this sector is currently under a total-embargo suppression. */
  embargoSuspended?: boolean;
  /** Operating/maintenance cost, shown NET of labour when the labour system is on. */
  maintenance: number;
  /** Labour/wage cost carved out of maintenance (0 when wages are disabled). */
  laborCost: number;
  growthCost: number;
  /** Tech-tree growth cost reduction in percentage points (0 when none or feature off). */
  techGrowthCostReductionPct?: number;
  profit: number;
  /** Federal corporate tax rate for this sector's country (%). */
  federalTaxRate: number;
  /** State/regional corporate tax rate for this sector's state (%). */
  stateTaxRate: number;
  /**
   * Approximate federal tax on this sector's own operating profit at the current rate.
   * Actual per-turn deduction apportions corp-level overhead across sectors by revenue
   * share, see corporation Financials tab for exact totals.
   */
  federalTaxApprox: number;
  /** Same as federalTaxApprox but for the sector's state/regional rate. */
  stateTaxApprox: number;
  /** This sector's revenue-weighted share of corp-level overhead (marketing + logistics + CEO salary). */
  corpOverheadShare: number;
  /** Net Profit minus the overhead share, floored at zero, the base the tax rates apply to. */
  taxableIncome: number;
}

export interface Competitor {
  corporationName: string;
  corporationId?: string;
  corporationSequentialId?: number;
  brandColor?: string;
  revenue: number;
  marketShare: number;
}

export interface SplitSizeInfo {
  splitCost: number;
  splitMsCost: number;
  splitEstimatedCapture: number;
  /** Estimated net income: capture × current effective margin. Approximate for competitor sectors. */
  splitEstimatedNetIncome: number;
  /** Projected market share after this capture. */
  projectedMarketShare: number;
  /** True when the projected share would cross the 50% dominance threshold. */
  exceedsDominanceThreshold: boolean;
  /** Per-strength cost/capture breakdown. Present on pages loaded after the split-strength feature. */
  splitStrengths?: {
    full: SplitStrengthInfo;
    half: SplitStrengthInfo;
  };
}

export interface SplitStrengthInfo {
  splitCost: number;
  splitMsCost: number;
  splitEstimatedCapture: number;
  splitEstimatedNetIncome: number;
  projectedMarketShare: number;
  exceedsDominanceThreshold: boolean;
}

export interface AttackInfo {
  attackCost: number;
  splitCost: number;
  splitEstimatedCapture: number;
  splitMsCost: number;
  userMarketingStrength: number;
  userLiquidCapital: number;
  userLiquidCurrencyCode?: string | null;
  stateId: string;
  countryId?: string;
  /** Per-strength cost/capture breakdown. Present on pages loaded after the split-strength feature. */
  splitStrengths?: {
    full: SplitStrengthInfo;
    half: SplitStrengthInfo;
  };
  /** The viewed sector's current effective profit margin (%). Used to estimate net income. */
  sectorEffectiveMargin?: number;
}

export interface Market {
  totalMarket: number;
  marketShare: number;
  competitors: Competitor[];
  unownedRevenue: number;
  unownedPercent: number;
}

/**
 * Why the money figures (revenue, profit, margin, wages, the whole plants
 * money/plant panel) are or are not on screen. Sent on every response so a
 * withheld value renders as a labelled "Hidden" state instead of a bare ", "
 * that reads as a real $0.
 *
 * - `visible`      the viewer is the owning CEO or an admin: nothing withheld.
 * - `private-corp` a signed-in non-owner looking at a PRIVATE corp.
 * - `public-rival` a signed-in non-owner looking at a PUBLIC corp (competitors
 *                  cannot see each other's live sector financials).
 * - `signed-out`   nobody is authenticated on this device, the single most
 *                  common cause of "my own sector shows dashes": you are not
 *                  logged in as the owner here.
 */
export type FinancialVisibilityReason = "visible" | "private-corp" | "public-rival" | "signed-out";

export interface FinancialVisibility {
  hidden: boolean;
  reason: FinancialVisibilityReason;
}

// Extractable resource capacities for this sector's state (units/turn).
// null = no capacity document (uncapped). 0 = deposits absent for that resource.
export type StateResources = Partial<Record<string, number>> | null;

/**
 * Extraction only, per-resource deposit view for the sector's state.
 * `desired` is the total unconstrained output every extraction sector in the
 * state wants; `headroom` = capacity − desired (negative = oversubscribed).
 */
export interface ExtractionCapacityRow {
  resource: string;
  capacity: number;
  desired: number;
  headroom: number;
}

/** One other state with free capacity for a binding resource (the signpost). */
export interface OpportunityState {
  stateId: string;
  countryId: string;
  capacity: number;
  desired: number;
  headroom: number;
}

/**
 * Signpost data: for each resource this capacity-bound extraction sector is
 * limited by, the other states where that resource still has room to grow.
 */
export interface ResourceOpportunity {
  resource: string;
  states: OpportunityState[];
}

/**
 * Buyer-side eligibility info for purchasing a listed sector. Only present
 * when the viewer is a CEO of a different corp than the seller AND the sector
 * is currently listed for sale.
 */
export interface ForSaleInfo {
  viewerCorporationId: string;
  /** Currency code that priceInViewerCapital is denominated in */
  viewerLiquidCurrencyCode?: string | null;
  /** Asking price converted to viewer corp's home currency */
  priceInViewerCapital: number;
  /** Viewer's available capital, normalized to ₳ for the buyer-side check */
  viewerCapitalAnchor: number;
  /** True iff buyer can complete the purchase (has sufficient funds) */
  eligible: boolean;
  /** Buyer already owns this sector type in this state, purchase becomes a merge */
  conflict: boolean;
  /** Buyer has enough liquid capital */
  hasFunds: boolean;
}

// ─── Plants tier (marketSystemMode >= "plants") ──────────────────────────────
// Mirrors `SectorPlantsSection` in src/lib/corporations/queries/sectorDetailSections.ts.
// MONEY: every `*Anchor` field is ₳ on the daily basis, pass straight to
// `formatAmount` with no currency code. UNITS: output units per financial day.

export type PlantIdleCauseKey =
  "inputs" | "strike" | "disaster" | "policy" | "deposits" | "mothballed" | "other";

export interface PlantIdleCause {
  cause: PlantIdleCauseKey;
  units: number;
}

export interface PlantBuildOrderView {
  /** Index the cancel action posts back as `orderIndex`. */
  orderIndex: number;
  unitsOrdered: number;
  /** Units delivered into capacity so far (ramps up for a smooth order). */
  unitsDelivered: number;
  /** True when this order ramps in per turn rather than landing all at once. */
  smooth: boolean;
  costPaidAnchor: number;
  startTurn: number;
  onlineTurn: number;
  turnsRemaining: number;
  /** 0 to 1 share of capacity delivered so far. */
  progress: number;
}

export interface PlantsData {
  capacityUnits: number | null;
  producedUnits: number | null;
  soldUnits: number | null;
  unsoldUnits: number | null;
  idleUnits: number | null;
  fillRate: number | null;
  idleCauses: PlantIdleCause[];
  mothballed: boolean;
  buildQueue: PlantBuildOrderView[];
  constructionInProgressAnchor: number;
  depreciationPerTurn: number;
  buildTurns: number;
  workers: number;
  unionizationPct: number;
  laborIntensity: number;
  governor: {
    active: boolean;
    startTurn: number | null;
    rampTurns: number;
    turnsRemaining: number;
    cap: number;
  };
  headroomUnits: number;
  /**
   * True buyers' room in sector output units (unmet demand across the output
   * mix, min over legs; 0 in a glut). `headroomUnits` is claimable market
   * share, NOT demand, optional because payloads predating the split omit it.
   */
  demandGapUnits?: number;
  currentTurn: number;
  buildQuote: {
    unitPriceAnchor: number;
    dominanceMultiplier: number;
    rateMultiplier: number;
    acumenMultiplier: number;
    techMultiplier: number;
    hostPriceMultiplier: number;
    perUnitAnchor: number;
    /** C9: cross-currency transfer fee rate charged on top (0 when same currency). */
    fxSpreadRate: number;
    /** perUnitAnchor × (1 + fxSpreadRate), what a unit actually costs. */
    perUnitChargedAnchor: number;
    corpCapitalAnchor: number;
    maxAffordableUnits: number;
  };
  pnl: {
    revenueAnchor: number;
    inputsAnchor: number;
    labourAnchor: number;
    upkeepAnchor: number;
    complianceAnchor: number;
    otherOperatingAnchor: number;
    growthAndBuildAnchor: number;
    profitAnchor: number;
    financialEventsAnchor: number;
    avgSalePriceAnchor: number | null;
    profitPerUnitAnchor: number | null;
  };
  /**
   * Three-number headline (see SectorPlantsSection.truth in the query layer).
   * Optional because payloads predating the field omit it.
   */
  truth?: {
    soldFraction: number | null;
    soldByCommodity: { commodity: string; fraction: number }[];
    /**
     * Share of offered output no freight network could place. Separates a
     * delivery failure from a demand failure, which call for opposite
     * responses. Optional for payloads predating it; absent reads as 0.
     */
    deliveryLimitedFraction?: number;
    /** Consecutive turns under half fill; optional for payloads predating it. */
    lowFillTurns?: number;
    /** Unsold-output inventory (§6); optional for payloads predating it. */
    inventory?: {
      stockpileUnsold: boolean;
      heldUnits: number;
      heldValueAnchor: number;
      byCommodity: { commodity: string; units: number }[];
      drainedUnits: number;
      spoiledUnits: number;
    };
    /** Realized revenue per unit PRODUCED, unsold units included at zero. */
    receivedPerUnitAnchor: number | null;
    /** Full operating cost spread over every unit produced. */
    costPerUnitAnchor: number | null;
    /** Realized profit over the cost of everything produced, percent. */
    fillAdjustedMarginPct: number | null;
    breakEven: {
      status: "profitable_now" | "turns" | "not_at_current_fills";
      turns: number | null;
    };
  };
}
