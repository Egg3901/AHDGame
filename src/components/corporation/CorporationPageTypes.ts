import type { CorporationType } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { LoyaltyLabel } from "@/lib/market/brandLoyalty";
import type { FillRateBand } from "@/lib/corporations/financialFogOfWar";
import type { BuildQueueSummary } from "@/lib/corporations/sectorBuildQueue";

export interface ShareholderInfo {
  /** Set for individual character shareholders */
  characterId?: string;
  /** Set for corporate shareholders */
  corporationId?: string;
  shares: number;
  /** Founder supershare count (dual-class corps). Votable amount is min(superShares, shares). */
  superShares?: number;
  name: string;
  sequentialId?: number;
  /** Corporate shareholder: issuer's logo (same Avatar `url` as character avatars) */
  logoUrl?: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  /** Character shareholder's home state — used to gate the Vote CEO button to HQ-state residents. */
  homeState?: string;
  /** Character shareholder's country — vote eligibility also requires same country as corp HQ. */
  countryId?: string;
  /** Imperial-character shareholders can't be CEO candidates (vote API only resolves `characters`). */
  isImperial?: boolean;
  /** NPP shareholders — display name only, no profile link or voting. */
  isNpp?: boolean;
  /** True when this shareholder is an index fund (fundId was set). */
  isFund?: boolean;
  /** Fund slug for linking to /stockmarket/.../fund/[slug]. Only present for index-fund shareholders. */
  fundSlug?: string;
  /** Fund scope — drives which stockmarket path segment to use. */
  fundScope?: "country" | "global";
  /** Country code for country-scoped funds. */
  fundCountryId?: string;
}

/**
 * Corp-wide physical rollup (plants tier). Null outside plants.
 * Units are output units on the DAILY clock, matching every per-sector figure.
 */
export interface CorporationPhysicalRollup {
  capacityUnits: number;
  producedUnits: number;
  soldUnits: number;
  /** Σsold ÷ Σproduced, not the mean of per-sector ratios. Null if nothing ran. */
  fillRate: number | null;
  /** Capacity paid for but not yet productive, ₳. */
  constructionInProgressAnchor: number;
  unitsOnOrder: number;
  buildingSectorCount: number;
  mothballedSectorCount: number;
  sectorCount: number;
}

/** One procurement contract as the supplying CEO sees it. */
export interface CorporationContractView {
  _id: string;
  countryId: string;
  component: string;
  lotsOrdered: number;
  lotsDelivered: number;
  pricePerLot: number;
  status: string;
  /** Lots this plant would deliver next turn at its current output. */
  projectedLotsPerTurn: number;
  /** Revenue earned so far — lots delivered x the struck price. */
  earned: number;
  /** Whole lots built and banked but not yet shipped, and the fraction still accumulating. */
  lotsBuiltNotDelivered: number;
  partialLot: number;
  /** Cash received, and what building those lots cost - margin, not gross. */
  amountPaid: number;
  productionCostPaid: number;
  /** Break-even for one lot at current input prices; null when the plant no longer exists. */
  unitProductionCost: number | null;
  /** Local currency the buyer still has committed against this order. */
  encumberedAmount: number;
  /** Why the last delivery turn banked output instead of shipping it. */
  carryReason?: string;
  carryReasonText?: string;
  carryReasonTurn?: number;
  /** Production lines this order holds, and the plant's total (suggestion #281). */
  assignedFactories: number;
  totalFactories: number;
  /** Which plant this order is on (name or host state). */
  plantLabel: string;
  /** The grade this order is written for (0..3). */
  gradeCeiling?: number;
  /** Public disclosure that the awarding minister had an interest in this corporation. */
  selfDealing?: { basis: "owner" | "shareholding"; stakeShare: number; ministerName?: string };
  /** How a cancelled order ended, and what the buyer owed for ending it that way. */
  termination?: {
    basis: "withdrawal" | "cause" | "convenience";
    fee: number;
    lotsCancelled: number;
    ministerName?: string;
  };
}

/**
 * Defence procurement position — the orders a corporation holds from governments, what
 * they have earned, and the grade ceiling its R&D puts on what it can deliver.
 *
 * Served by `/api/corporations/[id]` as a SIBLING of `corporation`, not a field on it —
 * reading it off the corporation object yields undefined and a permanently empty panel.
 */
export interface CorporationDefenceView {
  contracts: CorporationContractView[];
  /** Offers awaiting this CEO's answer. */
  pendingCount: number;
  /** Highest grade this corporation can currently deliver (0..3). */
  gradeCeiling: number;
  totalEarned: number;
  /** Earnings net of what building the materiel cost. */
  totalNetMargin: number;
  /** Local currency governments still have committed against this corporation's orders. */
  totalEncumbered: number;
}

export interface CorporationDetail {
  /**
   * True when this world runs `marketSystemMode >= "plants"` — sectors are
   * plants you BUILD, so every surface swaps its growth vocabulary for a
   * capacity one. Absent/false everywhere else.
   */
  plantsMode?: boolean;
  /** Corp-wide physical rollups; null/absent outside plants. */
  physical?: CorporationPhysicalRollup | null;
  _id: string;
  sequentialId?: number;
  name: string;
  /**
   * CEO self-acquisition window status — present only for the corp's own CEO.
   * Drives the buy-modal live status + countdown for the 10%/120-turn cap.
   */
  ceoShareWindow?: {
    capShares: number;
    acquiredShares: number;
    remainingShares: number;
    freesUpInTurns: number;
    capPercent: number;
    windowTurns: number;
  } | null;
  /** Stock ticker symbol (1–5 uppercase letters). Absent on legacy corps. */
  tickerSymbol?: string;
  description?: string;
  type: CorporationType;
  /** Country where the corporation is headquartered */
  countryId: string;
  secondaryType?: CorporationType | null;
  typeSwitchCooldownUntilTurn?: number | null;
  typeSwitchTurn?: number | null;
  currentTurn: number;
  typeLabel: string;
  headquartersState: string;
  headquartersStateName: string;
  liquidCapital: number;
  /** Currency code for liquidCapital (defaults to "USD" for pre-forex corps) */
  liquidCurrencyCode: string;
  marketingBudget: number;
  ceoSalary: number;
  brandColor?: string;
  marketingStrength: number;
  marketingStrengthGrowth: number;
  /**
   * Brand loyalty (Package A) player-facing 5-label scale. Present for everyone
   * when the feature is on for this corp; absent ⇒ hide the indicator. The RAW
   * number is NEVER sent to non-owners.
   */
  brandLoyaltyLabel?: LoyaltyLabel;
  /** RAW brand loyalty (0–100) — owner/CEO only. Absent for other viewers. */
  brandLoyalty?: number;
  /** Corp's established price-identity norm (0–1) — owner/CEO only, for pricing hints. */
  brandPostureNorm?: number;
  /** Average product quality (0–100) — shown as a number to everyone when present. */
  averageQuality?: number;
  logisticsBudget: number;
  logisticsStrength: number;
  logisticsStrengthNetChange: number;
  rdBudget: number;
  rdScore: number;
  rdScoreNetChange: number;
  marketCapitalization: number;
  logoUrl?: string;
  headerImageUrl?: string;
  /** Share price (single source of truth for all contexts). */
  sharePrice: number;
  totalShares: number;
  publicFloat: number;
  shareholders: ShareholderInfo[];
  /** Dual-class supershare vote multiplier; absent = one share one vote. */
  superShareMultiplier?: number;
  /** Turn the dual-class structure was adopted. */
  superSharesAdoptedAtTurn?: number;
  dividendRate: number;
  lastDividendChange: string | null;
  lastShareIssuance: string | null;
  /** Share-buyback settlement mode: "instant" (treasury) or "escrow" (market-making desk). */
  shareBuybackMode?: "instant" | "escrow";
  /** Share-buyback escrow balance in the corp's local currency; may be negative (a buyback debt). */
  shareEscrowBalance?: number;
  /** Local-currency amount auto-funded from treasury into escrow each turn (escrow mode). */
  escrowFundingPerTurn?: number;
  /**
   * Most recent per-turn net income in the corp's local currency. Drives the
   * escrow auto-funding warning in the CEO Budget panel. Undefined for legacy
   * corps with no income data.
   */
  recentNetIncome?: number;
  /** Turn of the CEO's last escrow withdrawal (enforces the 24-turn cooldown). */
  lastEscrowWithdrawalTurn?: number;
  /** Turn when CEO last ran a stock split / reverse split */
  lastShareStructureTurn?: number | null;
  /** Turns until CEO may change share structure again (0 = allowed) */
  shareStructureCooldownTurnsRemaining?: number;
  /** Era-scaled reverse-split floor (share counts deflate with the era). */
  shareConsolidationMinTotalShares?: number;
  /** Era-scaled founding share base, for the "founding size" shortcut. */
  foundingTotalShares?: number;
  ceoVacant: boolean;
  /** Character ID of the current CEO (absent for NPC/NPP/imperial CEOs). Used for concentration-penalty tooltip. */
  ceoCharacterId?: string | null;
  /** Underlying owner character while an NPP caretaker runs the corp (absent otherwise). Keeps the CEO tab reachable for reclaim. */
  caretakerUnderlyingCharacterId?: string | null;
  /** Turns left on the post-reclaim cooldown before a new caretaker may be installed (0 = none). */
  caretakerReappointCooldownTurnsRemaining?: number;
  pendingCeoCharacterId: string | null;
  createdAt: string;
  /**
   * Persisted, announced credit rating from the last turn's snapshot. Matches the
   * credit-rating-change notification. Preferred over the live-recomputed
   * `bondInfo.creditRating.rating` for the DISPLAY label (the live recompute
   * double-smooths and can diverge). Absent for pre-snapshot (legacy) corps.
   */
  creditRatingSnapshot?: string;
  /**
   * Percent of shares held by index funds (0–100, one decimal). Suggestion #62.
   */
  indexOwnershipPercent?: number;
  /**
   * True when index ownership has reached the level that earns the one-notch
   * credit upgrade and the share-price premium.
   */
  indexInclusionActive?: boolean;
  /** Persisted smoothed composite score matching `creditRatingSnapshot`. */
  creditCompositeSnapshot?: number;
  /** Country owner ID for national corporations */
  countryOwnerId?: string;
  /** Whether this corporation is nationalized (margin penalty applies) */
  isNationalized?: boolean;
  /** Whether the corporation is private (financials hidden from non-CEO viewers) */
  isPrivate?: boolean;
  /** Global feature gate — when true, the decade-gated Tech tab is shown. */
  techTreesEnabled?: boolean;
  /** Global feature gate — when true, the private supply-agreements panel is shown to the CEO. */
  supplyAgreementsEnabled?: boolean;
  /** Global feature gate — when true, the Contracts tab (offers/active extraction contracts) is shown. */
  contractIssuanceEnabled?: boolean;
  /** ID of an open privatization vote, if any. Used to mount the vote panel. */
  openPrivatizationVoteId?: string | null;
  /**
   * Public executive-nationalization risk surface (player corps only). Present
   * while the corp's financial-distress grace clock runs; drives the at-risk
   * badge. Null/absent when not at risk.
   */
  nationalizationRisk?: { sinceTurn: number; turnsUntilEligible: number } | null;
  /**
   * Public legislative-nationalization threat surface (non-state corps). Present
   * when a pending taking or a bill in voting targets the corp or its sectors;
   * drives the "facing nationalization" hero chip. Null/absent when none.
   */
  nationalizationThreat?: {
    whole: boolean;
    sectorCount: number;
    stage: "voting" | "pending" | "both";
    soonestTakingDeadlineTurn: number | null;
    turnsUntilTaking: number | null;
  } | null;
  /** Turn when corp last did an IPO (private→public). Used for cooldowns. */
  lastIpoTurn?: number;
  /** Turn when corp last went private via buyout. Used for IPO cooldown anchor. */
  lastPrivatizationTurn?: number;
  /** Turn when corporation was last renamed (48-turn cooldown). Null if never renamed. */
  lastRenameTurn?: number | null;
  /** ISO string of last shareholder address send (12-hour cooldown). Null if never sent. */
  lastShareholderAddressAt?: string | null;
  /** Active legal structure short name (e.g. "LLC", "C-Corp"). */
  legalStructureLabel?: string;
  /** Active legal structure ID (defaults to country default when absent). */
  legalStructure?: string;
  /** Turn when CEO may next change legal structure (48-turn cooldown). */
  legalStructureChangeCooldownUntilTurn?: number | null;
  /** Another corporation holds >50% — subsidiary of this parent */
  parentCorporation?: {
    _id: string;
    sequentialId?: number;
    name: string;
    ownershipPct: number;
  } | null;
  /** Corps this corporation controls (>50% corporate stake) */
  subsidiaries?: Array<{
    _id: string;
    sequentialId?: number;
    name: string;
    ownershipPct: number;
  }>;
  /** Logged-in CEO may merge if their corp holds >75% */
  hostileTakeoverEligibility?: {
    parentCorporationId: string;
    ownershipPct: number;
    outstandingBonds: number;
    outstandingBondDebt: number;
    parentLiquidCapital: number;
    parentLiquidCurrencyCode: string;
  } | null;
  /** Subsidiary corporations (feature-gated). This corp is a formalized subsidiary. */
  isFormalizedSubsidiary?: boolean;
  /** Viewer is CEO of the corp controlling >50% of this target and may formalize it. */
  canFormalizeAsSubsidiary?: boolean;
  /** Viewer is CEO of the corp controlling this formalized subsidiary (may appoint CEO, inject capital, set floor, release). */
  canManageAsParent?: boolean;
  /** Viewer is CEO of this (parent-eligible) corp and may spin off a sector into a new subsidiary. */
  canSpinOff?: boolean;
  /** Active parent-set dividend floor (percent), honored while the setter still controls >50%. */
  parentDividendFloorPct?: number;
}

export interface MyShareOrder {
  _id: string;
  type: "buy" | "sell";
  shares: number;
  sharesRemaining: number;
  pricePerShare: number;
  escrowAmount: number;
  status: "open" | "filled" | "cancelled";
  createdAt: string;
}

export interface OrderbookLevel {
  price: number;
  shares: number;
  orderCount: number;
}

export interface Orderbook {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface MarketOrder {
  _id: string;
  type: "buy" | "sell";
  sharesRemaining: number;
  pricePerShare: number;
  characterName: string;
  characterSequentialId?: number;
  isMine: boolean;
  isFundOrder: boolean;
  createdAt: string;
}

export interface CorpHistoryPoint {
  turn: number;
  sharePrice: number;
  marketCap: number;
  liquidCapital: number;
  revenue: number;
  totalCosts: number;
  income: number;
  /** Pre-tax income minus overhead. Optional — older snapshots lack it. */
  incomePreDividends?: number;
  /** Dividends distributed this turn. Optional — older snapshots lack it. */
  dividendPaidPerTurn?: number;
  /** Federal + state combined tax paid this turn (₳/turn). */
  corporateTaxPaid?: number;
  /** Federal corporate tax paid this turn, summed across countries (₳/turn). */
  federalTaxPaid?: number;
  /** State/regional corporate tax paid this turn, summed across states (₳/turn). */
  stateTaxPaid?: number;
  /** Coupon income earned from held bonds this turn. */
  perTurnBondCouponIncome?: number;
  /** Gross bond coupon expense on issued bonds this turn (before natcorp subsidy). */
  perTurnBondInterestExpense?: number;
  /** Interest drag from issued bonds this turn. */
  perTurnBondDragOnNetIncome?: number;
  /** Per-country federal tax breakdown. Only populated for multinationals. */
  taxPaidByCountry?: Record<string, number>;
  /** Per-state/region state tax breakdown. Only populated for multi-state corps. */
  taxPaidByState?: Record<string, number>;
  /** Domestic/foreign split of taxPaidByCountry — federal tax from corps HQ'd in the sector's country. */
  taxPaidByCountryDomestic?: Record<string, number>;
  /** Federal tax from corps HQ'd elsewhere (foreign-to-sector). */
  taxPaidByCountryForeign?: Record<string, number>;
  /** State tax from corps HQ'd in the same country as the sector. */
  taxPaidByStateDomestic?: Record<string, number>;
  /** State tax from corps HQ'd outside the sector's country. */
  taxPaidByStateForeign?: Record<string, number>;
  marketingStrength: number;
  logisticsStrength?: number;
  /** Brand loyalty (0–100). Optional — only present when the feature is enabled. */
  brandLoyalty?: number;
  /** Average product quality (0–100). Optional — only present when the feature is enabled. */
  averageQuality?: number;
  /** Physical output units per commodity this turn. Optional — post-0.4.1 snapshots. */
  commodityOutput?: Record<string, number>;
  dividendRate: number;
  creditComposite?: number;
  creditRating?: string;
  marginDiagnostic?: {
    effectiveMargin: number;
    commodityInputMod: number;
    commoditySurplusMod: number;
    exportPremiumMod?: number;
    macroMod: number;
    stateMetricsMod: number;
    legacyStateMetricsMod?: number;
    growthCostRatio: number;
    sectorCount: number;
  };
  /** Snapshot's money-field currency (Task 10, v0.2.6). Missing = legacy ₳. */
  currencyCode?: string;
  /**
   * The `currencyCode` FX rate (local per 1 ₳) in effect at write time. Charts
   * MUST use this — not the live/current rate — to convert this row's money
   * fields back to ₳, or every historical point drifts by however much FX has
   * moved since that turn (#2958). Missing = legacy row written before this
   * field existed; readers fall back to the live rate for those.
   */
  fxRateAtWrite?: number;
}

export interface CEO {
  characterId?: string;
  name: string;
  avatarUrl?: string;
  sequentialId?: number;
  isImperial?: boolean;
  /** NPP (autonomous politician) CEO — profile lives at /politicians/npp/[id]. */
  isNpp?: boolean;
  /** Canonical profile route for this CEO (character / imperial / NPP). */
  profilePath?: string;
  borderKey?: string | null;
  tintColor?: string | null;
}

export interface Financials {
  totalRevenue: number;
  /** Sector maintenance, shown NET of labour when the labour system is on. */
  maintenanceCosts: number;
  /** Labour/wage cost across sectors, carved out of maintenance (0 when wages are disabled). */
  laborCosts: number;
  growthCosts: number;
  marketingCosts: number;
  logisticsCosts: number;
  rdCosts: number;
  ceoSalaryCost: number;
  /** Bargained employer pension contribution under active collective agreements. */
  pensionContributionCost: number;
  /** Extra charged on top because a covered scheme is in deficit. */
  pensionTopUpCost: number;
  /** How many covered schemes are asking for that top-up. */
  pensionSchemesInDeficit: number;
  operatingCosts: number;
  operatingIncome: number;
  /** Federal corporate tax this turn (aggregated across sectors at each sector's country rate). */
  federalTax: number;
  /** State/regional corporate tax this turn (aggregated across sectors at each sector's state rate). */
  stateTax: number;
  /** Federal tax broken down by sector country (for tooltip display). */
  federalTaxByCountry: Record<string, number>;
  bondInterestCost: number;
  bondCouponIncome: number;
  /**
   * Dividend income (daily display units, local ccy) this corp received from
   * holding other corps' shares last turn, net of FX spread + the 50%
   * dividend-received-deduction tax. Already included in `income`. 0 when the
   * corp holds no dividend-paying corp shares (#3109).
   */
  dividendIncomeReceived: number;
  /** Government contribution that offsets bond interest for natcorps (state-owned corps) */
  governmentBondSubsidy: number;
  /** IMF facility principal+interest cash out (daily display units), when under active bailout */
  imfFacilityPaymentDaily: number;
  /** IMF facility cash in to the lender corp (daily display units) */
  imfFacilityReceiptsDaily: number;
  totalCosts: number;
  /**
   * PROJECTED per-turn net income (daily display units, local currency),
   * re-derived from live sector state. An estimate — it can diverge from what
   * the turn engine actually booked (embargo/tariff/clearing haircuts it can't
   * fully replicate). Prefer `realizedIncome` for the headline when present.
   */
  income: number;
  /**
   * REALIZED per-turn net income the turn engine actually booked last turn
   * (daily display units, local currency = corporationHistory.income × turns/day).
   * Absent for brand-new corps with no history. This is the ground-truth figure
   * — a corp draining cash shows negative here even if `income` looks positive
   * (ticket #935).
   */
  realizedIncome?: number;
  /** Turn the realized figure was booked on (for the "actual, last turn" chip). */
  realizedIncomeTurn?: number;
  /**
   * Dividends the engine actually paid out of last turn's income (daily display
   * units, local currency). `realizedIncome` is ALREADY net of this. Present
   * only alongside `realizedIncome`. Use it to rebuild the pre-dividend
   * headline; never subtract `dividendDistribution` from `realizedIncome`.
   */
  realizedDividendPaid?: number;
  /** CEO-set dividend rate (raw). Use effectiveDividendRate for what's actually paid out. */
  dividendRate: number;
  /** max(corp.dividendRate clamped, legalStructure.minimumDividendRate × 100). 0 when income ≤ 0. */
  effectiveDividendRate: number;
  /** Daily dividend payout in local currency, capped by income. */
  dividendDistribution: number;
  /** Daily dominance regulatory burden in local currency. Already included in operatingCosts. */
  regulatoryBurden: number;
  currentGrowthRate: number;
  subsidyBenefit: number;
}

/** Global / national / regional S&D weighting for commodity margin (percent of blend, sums to ~100). */
export interface CommoditySupplyDemandBlendPct {
  global: number;
  national: number;
  local: number;
}

export interface SectorDetail {
  _id: string;
  stateId: string;
  /** Country where this sector operates */
  countryId?: string;
  stateName: string;
  sectorType: string;
  sectorLabel: string;
  displayName?: string | null;
  targetGrowthRate: number;
  currentGrowthRate: number;
  currentGrowthCost: number;
  revenue: number;
  /** Realized revenue preferring the exact persisted figure, falling back to a
   *  blended-ratio estimate pre-reprocessing (#3001/#3002). Prefer this over
   *  `revenue` (nameplate) for anything presented to the player as "how much
   *  this sector makes" — matches the corp-level total's basis. */
  financialRevenue: number;
  /** Exact realized revenue when persisted; null pre-reprocessing. */
  realizedRevenue: number | null;
  /** Suspended by a total embargo the operating country has against this corp's
   *  nation: earns no revenue until the embargo is lifted. Surfaced in the UI. */
  embargoSuspended?: boolean;
  profitMargin: number;
  effectiveProfitMargin: number;
  /** How `effectiveProfitMargin` was produced. "physical": the engine's
   *  physically-derived margin, explained by `physicalCosts`; "additive":
   *  the legacy modifier-stack recompute (below plants / legacy sectors). */
  marginBasis?: "physical" | "additive";
  /** Physical cost legs as percentage points of realized revenue, present only
   *  when marginBasis is "physical". `otherPp` is the exact remainder (upkeep,
   *  other opex, financial legs, residual), so
   *  100 − inputsPp − laborPp − otherPp === effectiveProfitMargin. */
  physicalCosts?: {
    inputsPp: number;
    laborPp: number | null;
    otherPp: number;
    /**
     * The policy/tech modifier stack as percentage points of realized revenue,
     * SIGNED (positive = credit). Its own line rather than part of `otherPp`,
     * so this drilldown names the same stack the sector page's money chain
     * names (ticket 1122). 0 or absent on the fallback path, where the credit
     * cannot be separated from the residual.
     */
    policyPp?: number;
  } | null;
  /** Plants tier: realized profit over the full cost bill, percent. The honest
   *  counterpart to `effectiveProfitMargin`, which divides by sold revenue only
   *  and overstates a low-fill sector. Null below plants and when redacted. */
  fillAdjustedMarginPct?: number | null;
  /** This sector's market share (%) inside its (state, sectorType) bucket. Used
   *  to surface the dominance margin penalty / regulatory burden in the UI. */
  marketSharePercent: number;
  commoditySupplyDemandBlendPct?: CommoditySupplyDemandBlendPct;
  unemploymentModifier: number;
  gridReliabilityModifier: number;
  corruptionModifier: number;
  workforceSkillModifier: number | null;
  crimeRateModifier: number | null;
  broadbandModifier: number | null;
  roadConditionModifier: number | null;
  carbonEmissionsModifier: number | null;
  costOfLivingModifier: number | null;
  commodityModifier: number;
  homeLocationModifier: number;
  stateSectorSpecializationModifier: number;
  inflationModifier: number;
  debtToGdpModifier: number;
  deficitToGdpModifier: number;
  foreignTariffModifier: number;
  domesticTariffMalus: number;
  /** Margin bonus from unlocked tech-tree nodes (pp). Null when zero or tech trees disabled. */
  techMarginBonus?: number | null;
  stateMetricsModifier?: number;
  legacyStateMetricsModifier?: number;
  /** Named regional conditions (Economic Boom, Recession, …) stacked margin swing. */
  regionalConditionsModifier?: number;
  /** Itemized regional condition margin contributions for drill-down display. */
  regionalConditionModifiers?: { label: string; marginEffect: number }[];
  profit: number;
  workers: number;
  /** Federal corporate tax this sector owes this turn (computed live from current rates). */
  federalTaxPaid?: number;
  /** State/regional corporate tax this sector owes this turn (computed live from current rates). */
  stateTaxPaid?: number;
  /** Federal rate applied to this sector's country (%). */
  federalTaxRate?: number;
  /** State/regional rate applied to this sector's state (%). */
  stateTaxRate?: number;
  /** Active operating strategy ID */
  strategyId?: string;
  /** Extraction resource capacities for this sector's state. Undefined = no capacity doc. */
  stateResources?: Partial<Record<string, number>> | null;
  /** Strategy being transitioned from (null when not transitioning) */
  transitionFromStrategyId?: string | null;
  /** Turn when transition started */
  transitionStartTurn?: number | null;
  /** Turn when cooldown expires */
  transitionCooldownUntilTurn?: number | null;
  /** True when transition is reversing back to original strategy */
  isReversing?: boolean;
  /** CEO-set production policy target (-25 to +25) */
  productionPolicy?: number;
  /** Currently active production level (-25 to +25) */
  productionPolicyLevel?: number;
  /** Active for-sale listing — null when not on the secondary market */
  forSale?: {
    listedAt: string;
    /** Asking price in ₳ */
    priceAnchor: number;
    /** NPV in ₳ at the time of listing */
    npvAnchor: number;
  } | null;

  /* ── Plants tier (marketSystemMode >= "plants") ──────────────────────────
   * All null outside plants. Units are OUTPUT UNITS on the DAILY clock — the
   * same basis `revenue` uses, so capacity and revenue never need rescaling
   * against each other. */

  /** Nameplate productive capacity, units/day. */
  capacityUnits?: number | null;
  /** Persisted whole facilities owned by this sector. */
  plantCount?: number | null;
  /** Units produced last turn. */
  producedUnits?: number | null;
  /** Units sold last turn. */
  soldUnits?: number | null;
  /**
   * Exact fill rate (sold ÷ produced) in [0,1]. Null when the sector produced
   * nothing, AND null for a viewer without insider access — rivals get
   * `fillRateBand` only, because a precise fill rate is attack-targeting intel.
   */
  fillRate?: number | null;
  /** Coarse fill band. Present for everyone who can see the sector at all. */
  fillRateBand?: FillRateBand | null;
  /**
   * Share of offered output (0-1) no freight network could place. The part of
   * the fill shortfall that is a DELIVERY failure rather than a demand
   * failure, which is the opposite instruction to the player. Insider-only,
   * like `fillRate`: null when redacted, fogged, or below plants.
   */
  deliveryLimitedFraction?: number | null;
  /** Cargo class of the output leg behind the delivery limit. */
  deliveryLimitedFreightClass?: "bulk" | "special" | "grid" | null;
  /** Cold-stowed: produces nothing, pays reduced upkeep. */
  mothballed?: boolean;
  /** Outstanding capacity builds; null when nothing is on order. */
  buildQueueSummary?: BuildQueueSummary | null;
  /** Capacity paid for but not yet productive, ₳. */
  constructionInProgressAnchor?: number | null;
}

export interface HeldBondSummary {
  bondId: string;
  issuerName: string;
  units: number;
  couponRate: number;
  marketPrice: number;
  turnsRemaining: number;
  currentValue: number;
  dailyIncome: number;
}

export interface BalanceSheet {
  assets: {
    cashOnHand: number;
    sectorNPVs: Array<{
      sectorId: string;
      stateId: string;
      stateName: string;
      sectorType: string;
      dailyProfit: number;
      effectiveProfitMargin: number;
      npv: number;
    }>;
    totalSectorNPV: number;
    bondHoldingsValue: number;
    stockHoldingsValue: number;
    /** Principal outstanding on IMF bailout loans this corporation is owed as lender (₳). */
    imfFacilityReceivablesValue: number;
    imfFacilityReceivables: Array<{
      borrowerCorporationId: string;
      borrowerName: string;
      sequentialId?: number;
      principalOutstanding: number;
    }>;
    totalPortfolioValue: number;
    heldBonds: HeldBondSummary[];
    techAssetValue: number;
    totalAssets: number;
  };
  liabilities: {
    dailyCosts: number;
    totalDebt: number;
    dailyInterestCost: number;
    bondCount: number;
  };
  equity: {
    totalEquity: number;
    bookValue: number;
    marketCapitalization: number;
  };
}

export interface CreditRatingData {
  rating: string;
  compositeScore: number;
  components: {
    debtToEquity: number;
    interestCoverage: number;
    profitability: number;
    liquidity: number;
  };
  effectiveCouponRate: number;
  couponRatesByDuration: { 96: number; 240: number; 336: number };
  primeRate: number;
}

export interface BondData {
  _id: string;
  faceValue: number;
  couponRate: number;
  maturityTurns: number;
  issuedAtTurn: number;
  maturityTurn: number;
  marketPrice: number;
  /**
   * Face value outstanding in the BOND's own currency, which is not necessarily
   * the issuer's current one (a relocation re-denominates the corp but leaves
   * its outstanding bonds alone). Prefer `totalIssuedAnchor` for anything that
   * sums across bonds or compares against a corp-level figure.
   */
  totalIssued: number;
  /** Currency `totalIssued` is denominated in; absent on pre-forex bonds. */
  currencyCode?: string;
  /** `totalIssued` normalized to ₳. Absent only on a response from an older deploy. */
  totalIssuedAnchor?: number;
  publicFloat: number;
  defaulted: boolean;
  matured: boolean;
  turnsRemaining: number;
  holders: number;
  /** Original default turn — preserved on cured bonds for the BondsTab badge. */
  defaultedAtTurn?: number | null;
  /** Set when a default was resolved via cash / refinance / parent-payoff. */
  defaultCure?: {
    cureMethod: "cash" | "refinance" | "parent_payoff";
    curedAtTurn: number;
  };
}

/** Inputs surfaced for the credit rating tab (same math as server-side score). */
export interface CreditDiagnostics {
  totalEquity: number;
  annualIncome: number;
  annualCouponObligations: number;
  debtToEquityRatio: number | null;
  interestCoverageRatio: number | null;
}

/** Active IMF restructuring — tradable bonds are removed; debt lives in the facility. */
export interface ImfFacilitySummary {
  principalOutstanding: number;
  annualRatePercent: number;
  amortizationTurnsRemaining: number;
  /** Share of per-turn operating income that can go to facility payments (display %). */
  incomeCapturePercent: number;
}

export interface BondInfo {
  bonds: BondData[];
  /** Present while an IMF bailout program is active for this corporation. */
  imfFacility: ImfFacilitySummary | null;
  creditRating: CreditRatingData;
  totalDebt: number;
  /** Per-issuance cap in ₳: 25% of annual revenue, floored at $100M */
  maxPerIssuance?: number;
  /**
   * Effective issuance ceiling in ₳: the smallest of the per-issuance cap, the
   * 2x going-concern equity headroom, and the 1x exit-equity headroom (#1198).
   * Authoritative — the POST enforces exactly this, so render it rather than
   * re-deriving any one of the three rules here.
   */
  maxAllowedIssuance?: number;
  /** Effective minimum issuance in ₳: the flat minimum clamped to the corp's ceiling. */
  minIssuance?: number;
  /** False when the corp's headroom is below the dust floor and bonds are unavailable. */
  bondsAvailable?: boolean;
  /** What the corp could realize by selling up, in ₳ (#1198). */
  exitEquity?: number;
  /** Remaining debt-ceiling room in ₳, before the per-issuance cap (#1198). */
  debtHeadroom?: number;
  /** Which rule is currently binding on `maxAllowedIssuance` (#1198). */
  issuanceLimitedBy?: "perIssuance" | "leverage" | "exitEquity";
  isCeo: boolean;
  cooldownTurnsRemaining: number;
  /** ISO instant until which issuance is frozen for the launch window, else null. */
  issuanceFrozenUntil?: string | null;
  currentTurn: number;
  creditDiagnostics?: CreditDiagnostics;
  bondDefaultCreditPenalty?: {
    active: boolean;
    untilTurn: number | null;
  };
}

export type CorpTabId =
  | "overview"
  | "financials"
  | "sectors"
  | "commodities"
  | "shares"
  | "credit"
  | "charts"
  | "snapshot"
  | "tech"
  | "contracts"
  | "defence"
  | "deals"
  | "structure"
  | "ceo";

export interface PortfolioStockHolding {
  corporationId: string;
  corporationName: string;
  sequentialId?: number;
  logoUrl?: string;
  brandColor?: string;
  shares: number;
  avgCostPerShare: number | null;
  sharePrice: number;
  totalValue: number;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  currencyCode?: CurrencyCode;
}

export interface PortfolioBondHolding {
  bondId: string;
  issuerName: string;
  issuerSequentialId?: number;
  issuerBrandColor?: string;
  corporationId: string | null; // bond issuer corp ID (for linking)
  holderCorpId: string; // the portfolio corp that holds this bond (for sell endpoint)
  units: number;
  couponRate: number;
  marketPrice: number;
  maturityLabel: string;
  turnsRemaining: number;
  avgCostPerUnit: number | null;
  totalValue: number;
  dailyIncomePerTurn: number;
  defaulted: boolean;
  currencyCode?: CurrencyCode;
  /** Synthetic row for IMF bailout loan receivable (not a tradable bond). */
  imfFacilityLoan?: boolean;
}

export interface PortfolioData {
  stockHoldings: PortfolioStockHolding[];
  bondHoldings: PortfolioBondHolding[];
  totalStockValue: number;
  totalBondValue: number;
  totalPortfolioValue: number;
  totalUnrealizedPnl: number;
  totalCouponIncomePerTurn: number;
  history: Array<{
    turn: number;
    totalValue: number;
    stockValue?: number;
    bondValue?: number;
  }>;
}

export interface VoteTally {
  characterId: string;
  name: string;
  sequentialId?: number;
  avatarUrl?: string;
  votes: number;
}

/** Metadata attached to a public-corp response when financial fog of war is active. */
export interface FinancialFogMeta {
  isFinancialFogOfWar: true;
  /** Turn of the last quarterly snapshot used as the basis (null if no history yet). */
  fogSourceTurn: number | null;
  /**
   * Widest deviation the estimates can carry, as a fraction (0.1 = ±10%).
   * C3: the per-corp multiplier is never sent — publishing it made every
   * fogged figure exactly invertible.
   */
  maxDeviation: number;
  /** Key figures from the last quarterly snapshot — shown as "Last Reported" in the UI. */
  lastQuarterly: {
    revenue: number | null;
    income: number | null;
    totalCosts: number | null;
    liquidCapital: number | null;
    marketingStrength: number | null;
    logisticsStrength: number | null;
    turn: number | null;
    currencyCode: string | null;
  };
}
