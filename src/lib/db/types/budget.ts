import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type CreditRating = "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "CCC";
export type BudgetDocumentId = "federal" | "UK" | string;
export type CurrencyCode = "USD" | "GBP" | string;

export interface FederalRevenue {
  incomeTax: number;
  /** Tax collected from corps HQ'd in this country. */
  domesticCorporateTax: number;
  /** Tax collected from corps HQ'd elsewhere operating in this country. */
  foreignCorporateTax: number;
  payrollTax: number;
  tariffs: number;
  salesTax: number; // Default $0
  /**
   * DE Solidaritätszuschlag — surcharge on income tax owed. Computed as
   * `incomeTax × solidaritySurcharge / 100`. Other countries: undefined / 0.
   * Added 2026-05-26 with DE legislation overhaul (PR1).
   */
  solidaritySurcharge?: number;
  /**
   * CN 土地增值税 (Land Value-Added Tax) — capital-gains levy on real-estate
   * transactions. Computed against a real-estate-sector proxy base.
   * Other countries: undefined / 0. Added 2026-05-27 with CN legislation overhaul (PR1).
   */
  landValueAddedTax?: number;
  /**
   * CN 城市维护建设税 (Urban Maintenance & Construction Tax) — surcharge on
   * VAT receipts funding municipal infrastructure. Computed as
   * `salesTax × urbanMaintenanceTax / 100`.
   * Other countries: undefined / 0. Added 2026-05-27 with CN legislation overhaul (PR1).
   */
  urbanMaintenanceTax?: number;
  /**
   * Stamp Duty — small-rate tax on documented transactions (securities trades,
   * contracts, property transfers). Used by CN 印花税 and IE Stamp Duty.
   * Computed against a GDP-derived documented-transactions proxy.
   * Other countries: undefined / 0. Added 2026-05-27 with CN legislation overhaul (PR1);
   * IE adopted the same dial 2026-05-27 with the IE legislation overhaul (PR1).
   */
  stampDuty?: number;
  /**
   * IE Universal Social Charge — separate levy on gross wages above thresholds.
   * Computed as `wagesAndSalaries × universalSocialCharge / 100`.
   * Other countries: undefined / 0. Added 2026-05-27 with IE legislation overhaul (PR1).
   */
  universalSocialCharge?: number;
  /**
   * IE Capital Gains Tax — 33% statutory rate on realized gains.
   * Computed against a 3%-of-GDP proxy for annual realized capital gains.
   * Other countries: undefined / 0. Added 2026-05-27 with IE legislation overhaul (PR1).
   */
  capitalGainsTax?: number;
  /**
   * IE Excise Duty — multiplier-framed dial (100 = baseline) for alcohol /
   * tobacco / fuel duties. Computed against a 1.5%-of-GDP calibration base.
   * Other countries: undefined / 0. Added 2026-05-27 with IE legislation overhaul (PR1).
   */
  exciseDuty?: number;
  /**
   * IE Local Property Tax (LPT) — Revenue Commissioners-administered annual
   * property charge, collected at national level. Computed against a
   * band-averaged residential property base (0.5× GDP) so the statutory
   * 0.18% mid-band rate yields ~€500M/year.
   * Other countries: undefined / 0. Distinct from the state-level
   * StateRevenue.propertyTax used by US/UK/JP state budgets.
   * Added 2026-05-28 with the IE legislation overhaul audit fix.
   */
  propertyTax?: number;
  healthcareIncome: number;
  /**
   * Political-legislation v2 law revenue (spec §5.1): Σ annualRevenueV2 over
   * unrepealed national enacted laws, RECOMPUTED FROM SCRATCH on every sync
   * (idempotency rule — never folded into the carried-forward `other`). Sits
   * INSIDE the era revenue cap (ruling #14).
   */
  lawRevenue?: number;
  other: number;
  total: number;
}

export interface FederalTaxRates {
  incomeTax: number;
  /** Rate applied to corps HQ'd in this country. */
  domesticCorporateTax: number;
  /** Rate applied to corps HQ'd elsewhere. All-or-nothing — no country targeting. */
  foreignCorporateTax: number;
  payrollTax: number;
  tariffs: number;
  salesTax: number; // Default 0%
  /**
   * DE Solidaritätszuschlag — percentage applied to income tax owed (not income).
   * Stored as a plain percentage (e.g. 5.5 means 5.5% of incomeTax revenue).
   * Other countries: undefined / 0. Added 2026-05-26 with DE legislation overhaul (PR1).
   */
  solidaritySurcharge?: number;
  /**
   * CN 土地增值税 (Land Value-Added Tax) rate. Stored as a plain percentage.
   * Applied to a real-estate-sector proxy base in `calculateFederalRevenue`.
   * Other countries: undefined / 0. Added 2026-05-27 with CN legislation overhaul (PR1).
   */
  landValueAddedTax?: number;
  /**
   * CN 城市维护建设税 (Urban Maintenance & Construction Tax) rate. Stored as a
   * plain percentage applied as a surcharge on the salesTax (VAT) revenue line.
   * Other countries: undefined / 0. Added 2026-05-27 with CN legislation overhaul (PR1).
   */
  urbanMaintenanceTax?: number;
  /**
   * CN 印花税 (Stamp Duty) rate. Stored as a plain percentage applied to a
   * GDP-derived documented-transactions proxy.
   * Other countries: undefined / 0. Added 2026-05-27 with CN legislation overhaul (PR1).
   */
  stampDuty?: number;
  /**
   * IE USC rate (percentage applied to wages base).
   * Other countries: undefined / 0. Added 2026-05-27 with IE legislation overhaul (PR1).
   */
  universalSocialCharge?: number;
  /**
   * IE CGT rate (percentage applied to a 3%-of-GDP realised-gains proxy).
   * Other countries: undefined / 0. Added 2026-05-27 with IE legislation overhaul (PR1).
   */
  capitalGainsTax?: number;
  /**
   * IE Excise multiplier (100 = baseline calibration; not a true percentage).
   * Other countries: undefined / 0. Added 2026-05-27 with IE legislation overhaul (PR1).
   */
  exciseDuty?: number;
  /**
   * IE Local Property Tax rate (percentage applied to a band-averaged
   * residential property base: 0.5× GDP, calibrated so the statutory
   * 0.18% mid-band rate yields ~€500M/year). Other countries: undefined / 0.
   * Federal-level only — the state-level StateTaxRates.propertyTax remains
   * separate. Added 2026-05-28 with the IE legislation overhaul audit fix.
   */
  propertyTax?: number;
}

/**
 * Tax bases - the economic values that get taxed.
 *
 * **Currency:** Post-v0.2.6, all fields are denominated in the owning country's
 * currency (USD for US, GBP for UK, JPY for JP, etc.). Not ₳.
 *
 * The turn processor (`corporation/index.ts`) normalizes each corp's operating
 * income to ₳ across the accumulation phase (since corp currencies differ), then
 * multiplies by the country's FX rate when writing `domesticCorporateProfits` /
 * `foreignCorporateProfits` so the stored value lands in country currency.
 * `budget/revenue.ts` then computes revenue as `taxRate% × taxBase`, with both
 * sides in the same country currency.
 */
export interface FederalTaxBases {
  taxableIncome: number; // Total taxable income in the economy
  /** Corporate profits from corps HQ'd in this country. */
  domesticCorporateProfits: number;
  /** Corporate profits from corps HQ'd elsewhere operating in this country. */
  foreignCorporateProfits: number;
  wagesAndSalaries: number; // Total wages subject to payroll tax
  importValue: number; // Total value of imports
  taxableSales: number; // Total taxable consumer spending
}

/** Growth rates that affect tax bases (annual percentage) */
export interface EconomicGrowthFactors {
  gdpGrowth: number; // Overall GDP growth rate
  wageGrowth: number; // Wage growth rate
  inflationRate: number; // Inflation rate
  tradeGrowth: number; // Import/export growth
  lastUpdated: Date;

  // ── Command-economy readouts (P1+) ────────────────────────────────────────
  // Present only for planned economies while `commandEconomyEnabled` is on;
  // undefined for market economies / flag off. See @/lib/economy/commandEconomyState.
  /** Accumulated forced savings — money issued (mainly as wages) that finds no
   *  goods to buy at administered prices. Household-currency units. */
  monetaryOverhang?: number;
  /** Goods scarcity at administered prices, 0 (abundant) → 100 (acute), derived
   *  from the demand-vs-supply gap and the overhang relative to the money stock. */
  shortageIndex?: number;
  /** Shadow (black-market / swap-rate) premium over the official price/FX, as a
   *  fraction (0.3 = +30%). Rises with overhang + shortage, falls with tolerance. */
  blackMarketPremium?: number;
  /** Fraction of activity that has fled into the informal / second economy,
   *  0 → 1. Absorbs overhang; scaled by the repression-vs-tolerance lever. */
  secondEconomyShare?: number;
  /** Command Economy v2 (P0): the STORED, endogenous marketization level
   *  (0 command → 100 market). Seeded from the era schedule the first turn, then
   *  drifted each turn on black-market pressure + SOE performance + policy stance.
   *  Present only for planned economies while `commandEconomyEnabled` is on; the
   *  turn engine hydrates the in-process registry from this field. */
  marketizationLevel?: number;

  // ── Command Economy v2 (P1): active Gosbank (directed credit + soft budgets) ─
  /** Effective per-country budget-softness dial, 0 (hard: insolvent SOEs fold)
   *  → 1 (soft: losses persist, SOE spared). Written each turn by the command
   *  economy phase from the NPP Gosbank posture (or a P2 player override); read
   *  by `nppInsolvencyDissolution` to decide whether an insolvent SOE folds. */
  budgetSoftness?: number;
  /** P3: the LIVE government-reformism [−1, 1] that fed the marketization
   *  policy-stance term this turn, resolved from the elected ruling party's
   *  economic position (falling back to the NPP-brain stance). Persisted so the
   *  dashboard's marketization-driver readout reflects who actually governs,
   *  not just the NPP estimate. Readout only. */
  governmentReformism?: number;
  /** Per-sector directed credit allocated by Gosbank this turn (sector →
   *  household-currency amount). A readout of the allocation vector that raised
   *  each SOE's capacity/output; the P2 Gosbank panel will surface it. */
  directedCredit?: Record<string, number>;
  /** Monetized issuance this turn — the slice of directed credit NOT covered by
   *  real savings, which fed the monetary-overhang accumulator (the growth-vs-
   *  shortage tradeoff). Readout only. */
  directedCreditIssuance?: number;
  /** Plants tier: the slice of this turn's directed credit that bought back
   *  worn-out SOE capacity rather than funding growth (the replacement floor).
   *  Split out from the total because it does NOT answer to the Chair's
   *  `creditAggressiveness` lever: upkeep is not investment, and an SOE has no
   *  other channel to replace depreciation. At a zero-aggressiveness posture
   *  this is the entire credit bill, which is why the Gosbank keeps printing
   *  with the investment budget switched off. Readout only. */
  directedCreditUpkeep?: number;
  /** Command Economy v2 (internal repression): the HONORED internal-repression
   *  level [0, 1] the turn applied this turn (0 none … 1 heavy). Resolved from
   *  the player `repressionDirective` > NPP `commandStance.internalRepression` >
   *  default. Higher repression forces the black market down (easing marketization
   *  drift) but burns regime legitimacy — see `repressionLegitimacyCost`. Present
   *  only for planned economies while `commandEconomyEnabled` is on. */
  internalRepression?: number;
  /** Signed per-turn popular-legitimacy COST of this turn's repression, in
   *  [-1, 0]. Climbs with repression × shortage (repressing amid empty shelves is
   *  a pressure cooker). Recomputed and re-applied to `popularLegitimacy` by the
   *  one-party legitimacy phase; persisted here as a dashboard readout. */
  repressionLegitimacyCost?: number;
  /** Black-market pressure BEFORE repression (0..1) — what the marketization
   *  drift would have seen with no repression. Readout, for the dashboard to show
   *  how far repression forced the black market down. */
  blackMarketPressureBase?: number;
  /** Black-market pressure AFTER repression (0..1) — the value that actually fed
   *  the marketization drift this turn. Readout. */
  blackMarketPressureEffective?: number;
  /** Command Economy v2 SEAM: a player (head of government / Gosbank chair)
   *  internal-repression directive overriding the NPP-brain default. When present,
   *  the command economy phase honors `level` instead of the derived
   *  `commandStance.internalRepression`. */
  repressionDirective?: {
    /** 0 (no repression) → 1 (heavy). */
    level?: number;
    /** Last turn this directive was written (audit / staleness readout). */
    setOnTurn?: number;
    /** Character id of the official who set it (audit). */
    setByCharacterId?: string;
  };
  /** P2 SEAM: a player Gosbank Chair's directive overriding the NPP-brain
   *  defaults. When present, the command economy phase honors these instead of
   *  the government's derived `commandStance`. Absent → NPP brain runs Gosbank. */
  gosbankDirective?: {
    /** 0 (restrained) → 1 (flood the SOEs with cheap credit). */
    creditAggressiveness?: number;
    /** 0 (hard budgets) → 1 (soft budgets). */
    budgetSoftness?: number;
    /**
     * Command Economy v2 (P2): a player Gosbank Chair's explicit per-sector
     * directed-credit weighting (sector → relative weight, any non-negative
     * scale). When present and non-empty, the turn engine allocates the credit
     * budget by THESE weights instead of the automatic under-performer weighting
     * — this is the "pick the winners" lever. Absent → automatic allocation.
     */
    sectorCredit?: Record<string, number>;
    /** Last turn this directive was written (audit / staleness readout). */
    setOnTurn?: number;
    /** Character id of the Gosbank Chair who set it (audit). */
    setByCharacterId?: string;
  };
}

export interface FederalSpending {
  byCategory: Record<string, number>;
  stateGrants: number;
  debtInterest: number;
  total: number;
}

export interface FederalDebt {
  principal: number;
  interestRate: number;
  ceiling: number;
  ceilingLastRaisedYear: number;
}

/**
 * Authored starting point for sovereign-risk repricing. Historical debt
 * capacity and nominal-rate regimes differ sharply, so runtime changes are
 * measured relative to this seed instead of forcing every era through one
 * absolute modern debt/GDP ladder.
 */
export interface SovereignRiskAnchor {
  debtToGdpRatio: number;
  creditRating: CreditRating;
  interestRate: number;
}

// === Sovereign default subsystem types (phase 1+) ===

export type SovereignCrisisState =
  "normal" | "warning" | "crisisPending" | "crisisResolving" | "recovering";

export type SovereignResolutionChoice = "repudiate" | "restructure" | "bailout" | "monetize";

export type ImfBoardOverrideKind = "termsModified" | "publicEndorsement" | "publicCriticism";

export interface TurnAndRealtime {
  turn: number;
  realtimeMs: number;
}

/**
 * A country's defence account: funded from the enacted defence line, drained by the standing
 * force's upkeep and by procurement.
 *
 * NOT a second charge on the treasury. `processTreasuryTurn` already deducts the whole annual
 * spending line — defence included — from `treasuryBalance` at 1/TURNS_PER_YEAR each turn, so
 * this is a sub-ledger of money the treasury has already spent. The one exception is the
 * OVERDRAFT, which is spending beyond the enacted line that no budget row has accounted for,
 * and which therefore does hit `treasuryBalance` as ordinary national debt.
 */
export interface DefenseAppropriation {
  /** Signed, absolute local currency. Negative = drawn against the overdraft. */
  balance: number;
  /** Highest turn whose accrual has been applied. Replay guard against double-crediting. */
  accruedThroughTurn: number;
  /**
   * 0..1 share of last turn's upkeep left unfunded. Drives the readiness-baseline
   * suppression in `readinessDrift.ts`. Persisted rather than recomputed by readers because
   * the conflict record projects recovery outside the turn loop and must quote the same
   * number the tick drifted to.
   */
  arrearsRatio: number;
}

export interface FederalBudget {
  _id: BudgetDocumentId;
  countryId: string;
  fiscalYear: number;
  revenue: FederalRevenue;
  taxRates: FederalTaxRates;
  taxBases: FederalTaxBases;
  economicFactors: EconomicGrowthFactors;
  spending: FederalSpending;
  debt: FederalDebt;
  surplus: number;
  gdp: number; // National GDP (A1 SSOT = Σ regional state.gdp × 1M, set at fiscal close)
  /**
   * Labour system minimum wage, expressed as a Kaitz ratio (minimum wage ÷
   * median wage), 0–1. Absent/0 = no minimum wage. A national policy lever (like
   * taxRates) set by legislation/admin and read by the corporation turn to floor
   * low-pay sectors' labor cost. See docs/plans/2026-06-30-labour-system.md.
   */
  minimumWageKaitzRatio?: number;
  /**
   * v3 Phase 7b (labourSystemMode >= "full"): union-law bias, -50 (strong
   * right-to-work) to +50 (strong collective-bargaining protection), 0 =
   * neutral/no law. Set by an enacted `UnionLawProvision` bill (see
   * `applyUnionLawProvision` in `src/lib/labour/unionLaws.ts`) — unlike
   * `minimumWageKaitzRatio` above (admin-only today), this IS the
   * player-legislated path. Read by `buildUnionLawBiasByCountry`
   * (`src/lib/labour/laborCost.ts`) into `LabourContext`.
   */
  unionLawBias?: number;
  /**
   * Union ban (player suggestion #93): when true, unions are outlawed in this
   * country by an enacted `UnionLawProvision` with `banAction: "ban"`. While
   * banned: NPC unionization decays toward 0 (accelerated), the union wage
   * premium is not applied, strikes can't trigger (active ones end), player
   * union actions 403, and `processUnionsTurn` skips suspended unions.
   * Cleared by a `banAction: "repeal_ban"` provision. Written by
   * `applyUnionLawProvision` (`src/lib/labour/unionLaws.ts`); read into
   * `LabourContext` via `buildUnionsBannedByCountry` (`src/lib/labour/laborCost.ts`).
   */
  unionsBanned?: boolean;
  /** EMA-smoothed national GDP — debt-to-GDP / sovereign-default read this so
   *  year-over-year GDP swings can't trip a default threshold (design §5.4). */
  gdpSmoothed?: number;
  debtToGdpRatio: number;
  creditRating: CreditRating;
  sovereignRiskAnchor?: SovereignRiskAnchor;
  /**
   * Signed national cash position (country-local currency). Positive = accumulated
   * surplus/savings; negative = national debt. Source of truth for the fiscal
   * position; `debt.principal` is a derived mirror = max(0, −treasuryBalance).
   * Always present: set at every creation path (= −debt.principal) and backfilled
   * for existing docs; the turn engine self-heals any straggler null.
   */
  treasuryBalance: number;
  /**
   * Defence account (see {@link DefenseAppropriation}). Absent on unmigrated docs — read
   * through `getDefenseAppropriation`, which HEALS rather than defaulting to zero: a silent
   * empty pot would refuse every purchase for a country the migration missed, which reads to
   * a player as a broken button rather than a data gap.
   */
  defenseAppropriation?: DefenseAppropriation;
  /**
   * GDP at the moment this world's military prices were anchored. Unit prices are quoted
   * against `militaryPriceAnchor(gdp, this)` rather than live GDP, so a growing economy
   * outruns its own procurement costs instead of cancelling against them.
   *
   * Absent or non-positive ⇒ prices fall back to live GDP, which is exactly the pre-anchor
   * behaviour. That is the safe degradation; a zero baseline would anchor prices at zero and
   * make every unit free, which is why the migration only writes it when `gdp > 0`.
   */
  militaryPriceBaselineGdp?: number;
  currencyCode?: CurrencyCode;
  /**
   * Investor-confidence index (0–100, baseline 70). Decays toward baseline each
   * turn; nationalizations subtract. Feeds private margins, sovereign cost, and
   * new-corp founding (spec §12.4). Absent ⇒ treated as baseline.
   */
  investorConfidence?: number;
  /** Turn `investorConfidence` was last written (decay + audit). */
  investorConfidenceUpdatedAtTurn?: number;
  /**
   * State Ownership Concentration Index (SOCI, 0–100): state-owned corporate
   * revenue ÷ total national corporate revenue, recomputed each turn. Drives the
   * nationalization escalation multiplier (confidence hit, political cost, SOE
   * transition digestion). No artificial decay — falls only as the private
   * economy grows or the state privatizes. Absent ⇒ treated as 0.
   */
  stateOwnershipConcentration?: number;
  /** Turn `stateOwnershipConcentration` was last recomputed. */
  stateOwnershipConcentrationUpdatedAtTurn?: number;
  /**
   * Baseline spending by category, seeded from NationalBudgetSeedConfig.
   * Used as a fallback in calculateFederalSpending when no enacted spending
   * laws exist (incompletely-seeded countries like CN, BR, IE).
   */
  baselineSpendingByCategory?: Record<string, number>;
  baselineStateGrants?: number;
  /**
   * Fiscal-divergence guardrail (refs #fiscal-divergence-audit): each tax
   * base's share of national GDP at the turn this field was first populated
   * (self-healed once, on this country's first `fiscalBaseGrowth` pass —
   * mirrors `eraGdpPerCapitaBaseline`'s bootstrap-then-track pattern in
   * `nationalMetrics.ts`). `growFederalBases` grows each base by its own
   * wage/trade/GDP rate as before, then pulls it a small fraction of the way
   * back toward `currentGdp × thisBaseline[key]` every turn.
   *
   * Why: `wageGrowth`/`tradeGrowth` (metricEngine/registry/economic.ts) carry
   * a structural premium over realized `gdpGrowth` with no offsetting term —
   * wageGrowth adds a persistent labor-market "tightness" bonus
   * (`(5 - unemployment) * 0.3`) on top of the SAME productivity basis
   * `gdpGrowth` reverts to, and `tradeGrowth`'s `WORLD_TRADE_BASELINE` (2.5)
   * alone typically exceeds realized GDP growth. Applied to
   * `taxBases.wagesAndSalaries`/`taxableIncome`/`importValue` every turn with
   * no reconciliation, this compounds without bound (measured: US wage
   * share of GDP drifted 40% → 54% in 13 in-game years on the t650 sandbox
   * run) — pure "gravity," not a deliberate policy choice, yet it single-
   * handedly outpaces GDP-anchored spending and retires national debt. The
   * pull-back is partial (not a hard cap), so sustained deliberate policy
   * that keeps wage/trade growth elevated for real reasons still moves the
   * share over time; only the passive, undirected drift is bounded.
   */
  taxBaseGdpShareBaseline?: Partial<Record<keyof FederalTaxBases, number>>;
  /**
   * Sovereign bond maturity profile: fractional split across maturities.
   * Keys are turn counts (48, 96, 240); values are fractions summing to 1.
   * Used by the quarterly scheduled issuance path to split deficit+rollover
   * across multiple maturities. Falls back to SOVEREIGN_RECONCILE_DISTRIBUTION
   * when absent.
   */
  sovereignBondProfile?: Partial<Record<48 | 96 | 240, number>>;
  /** Turn at which the sovereignBondProfile was last changed. Used for rate-limiting. */
  sovereignBondProfileLastChangedTurn?: number;
  updatedAt: Date;

  // === Sovereign default subsystem (phase 1+) ===
  // All fields optional for backward compatibility with pre-migration documents.
  // Migration `sovereignDefaultPhase1FederalBudget.ts` backfills explicit values.

  // State machine
  sovereignCrisisState?: SovereignCrisisState;

  // Trigger tracking
  failedAuctionConsecutiveCount?: number;
  lastAuctionDemandRatio?: number;

  // Crisis lifecycle
  crisisFiredAt?: TurnAndRealtime | null;
  crisisChoice?: SovereignResolutionChoice | null;
  crisisChoiceAt?: TurnAndRealtime | null;
  crisisLegislativeProposalId?: ObjectId | null;
  // Turn-first deadline (resolved against `turn`; freezes on pause). `realtimeMs`
  // is kept for the wall-clock display/fallback + the legacy sparse index.
  crisisAutoActionAt?: TurnAndRealtime | null;
  crisisLegislativeDeadlineAt?: { realtimeMs: number } | null;

  // Recovery
  recoveryStartedAt?: { turn: number } | null;
  recoveryFiscalDisciplineStreak?: number;
  marketAccessLockedUntilTurn?: number | null;
  lastDefaultTurn?: number | null;
  /**
   * Sovereign-default recovery: per-turn GDP penalty fraction that the
   * recovery state machine (phase 8) will apply each turn. Set when the
   * resolution path enters recovering. Cleared on recovery exit.
   */
  recoveryGdpPenaltyPercent?: number | null;
  /**
   * Sovereign-default recovery: turns remaining in the GDP penalty window.
   * Decremented each turn by the recovery state machine (phase 8); when it
   * hits zero the penalty stops applying.
   */
  recoveryGdpPenaltyTurnsRemaining?: number | null;
  /**
   * Phase 11a — recovery credibility bonus: turn at which the post-recovery
   * coupon-rate discount expires. While currentTurn < this value, the
   * country's effective sovereign coupon rate is reduced by
   * RECOVERY_CREDIBILITY_RATE_DISCOUNT (pp). Stamped on clean exit from
   * recovery.
   */
  recoveryCredibilityBonusUntilTurn?: number | null;

  // === IMF sovereign facility (phase 1+) ===
  imfSovereignBailoutActive?: boolean;
  imfSovereignFacilityPrincipalOutstanding?: number;
  imfSovereignFacilityAnnualRate?: number;
  imfSovereignFacilityAmortizationTurnsRemaining?: number;
  imfSovereignFacilityIncomeCaptureFraction?: number;
  imfSovereignFacilityImfCorporationId?: ObjectId | null;
  /**
   * Cumulative anchor-units paid into the IMF facility for the lifetime of
   * this country's bailouts. Increments each turn when a facility payment
   * lands (post-FX-conversion to anchor). Used by the /international/imf
   * page to show running totals.
   */
  imfSovereignFacilityCumulativePaidAnchor?: number;

  // === IMF Board override window (phase 1+) ===
  // Turn-first window end (resolved against `turn`; freezes on pause).
  // `realtimeMs` retained for display/fallback + the legacy sparse index.
  imfBoardOverrideWindowEndAt?: TurnAndRealtime | null;
  imfBoardOverrideAt?: TurnAndRealtime | null;
  imfBoardOverrideBy?: ObjectId | null;
  imfBoardOverrideKind?: ImfBoardOverrideKind | null;
  imfBoardOverrideRateDelta?: number | null;
  imfBoardOverrideCaptureDelta?: number | null;
  imfBoardPublicStatement?: string | null;
}

/** Frozen snapshot of a country's federal budget at a fiscal year boundary. */
export interface FederalBudgetSnapshot {
  /** Composite key: "${countryId}:FY${fiscalYear}" e.g. "US:FY2021" */
  _id: string;
  countryId: string;
  fiscalYear: number;
  /** Game turn when the snapshot was taken */
  turn: number;

  /** Complete frozen budget state */
  budget: {
    revenue: FederalRevenue;
    taxRates: FederalTaxRates;
    taxBases: FederalTaxBases;
    spending: FederalSpending;
    debt: FederalDebt;
    economicFactors: EconomicGrowthFactors;
    surplus: number;
    gdp: number;
    debtToGdpRatio: number;
    creditRating: CreditRating;
    /**
     * Currency at snapshot time. Mirrors `FederalBudget.currencyCode` so
     * historical viewers don't have to re-derive from `countryId` (which can
     * drift if a country's mapping ever changes). Added v0.2.6; earlier
     * snapshots may lack this field — consumers fall back to
     * `resolveCountryCurrencyCode(countryId)` in that case.
     */
    currencyCode?: CurrencyCode;
  };

  /** State grants breakdown at this FY */
  stateGrants: { stateId: string; stateName: string; amount: number }[];

  /** Enacted fiscal laws active at this FY */
  enactedLaws: {
    title: string;
    budgetCategory: string;
    /** Formatted cost: "$750/person", "2.5% of GDP", "$500M", etc. */
    costModel: string;
    enactedYear: number;
  }[];

  createdAt: Date;
}

export interface StateRevenue {
  incomeTax: number;
  salesTax: number;
  /** Tax collected from corps HQ'd in the same country as this state. */
  domesticCorporateTax: number;
  /** Tax collected from corps HQ'd outside this state's country. */
  foreignCorporateTax: number;
  propertyTax: number;
  /**
   * DE Gewerbesteuer revenue at the Land level. Computed as
   * `domesticCorporateProfits × 0.035 × tradeTax / 100` where tradeTax stores
   * the Hebesatz (200-600) and 0.035 is the federally-fixed Steuermesszahl.
   * Other countries: undefined / 0. Added 2026-05-26 with DE legislation overhaul (PR1).
   */
  tradeTax?: number;
  federalGrants: number;
  other: number;
  /**
   * Accumulated extraction-contract royalty revenue (contract-issuance feature).
   * A persistent, dedicated line so per-turn contractSettlement credits ($inc on
   * this field + revenue.total) survive the annual fiscal recompute:
   * calculateStateRevenue reads this back and folds it into `total`, exactly like
   * `other`. Absent = 0 for legacy budgets.
   */
  resourceRoyalties?: number;
  total: number;
}

export interface StateTaxRates {
  incomeTax: number;
  salesTax: number;
  /** Rate applied to corps HQ'd in the same country as this state. */
  domesticCorporateTax: number;
  /** Rate applied to corps HQ'd outside this state's country. */
  foreignCorporateTax: number;
  propertyTax: number;
  /**
   * DE Gewerbesteuer-Hebesatz at the Land level (200-600 typical range).
   * NOT the effective rate — the engine multiplies by 0.035 (Steuermesszahl) to
   * derive the effective corporate-profits tax rate.
   * Other countries: undefined / 0. Added 2026-05-26 with DE legislation overhaul (PR1).
   */
  tradeTax?: number;
}

/**
 * State tax bases - economic values that get taxed at state level.
 *
 * **Currency:** Post-v0.2.6, all fields are denominated in the state's country's
 * currency. See {@link FederalTaxBases} for the full invariant; the state path
 * follows the same corp-turn normalization (state GDP → country currency; the
 * 25% "actual corp" weight is multiplied by the country's FX rate before
 * blending into the base).
 */
export interface StateTaxBases {
  taxableIncome: number; // State taxable income
  taxableSales: number; // State taxable sales
  /** State corporate profits from corps HQ'd in the same country. */
  domesticCorporateProfits: number;
  /** State corporate profits from corps HQ'd outside this state's country. */
  foreignCorporateProfits: number;
  propertyValue: number; // Total assessed property value
}

export interface StateSpending {
  byCategory: Record<string, number>;
  /**
   * Accumulated geological-survey spend funded by a state government
   * (prospecting feature). A persistent, dedicated line — the symmetric spending
   * analogue of {@link StateRevenue.resourceRoyalties}. `spending.byCategory` is
   * REBUILT from enacted laws on every annual recompute (calculateStateSpending),
   * so a raw byCategory key would be clobbered; this dedicated field is read back
   * and re-folded into `total` by calculateStateSpending / normalizeStateSpending
   * so per-turn `$inc`s survive. Absent = 0 for legacy budgets.
   */
  resourceProspecting?: number;
  total: number;
}

export interface StateBudget {
  _id: string;
  stateId: string;
  /**
   * Country that owns this state budget. Required to disambiguate cross-country
   * state-ID collisions (e.g. CN HB vs DE HB) — without this the bare stateId
   * `_id` would silently route to the wrong country.
   *
   * Optional in the type to ease forward compatibility with legacy rows; all
   * new seeds set it. Lookups should always include it when known.
   */
  countryId?: CountryId;
  fiscalYear: number;
  revenue: StateRevenue;
  taxRates: StateTaxRates;
  taxBases: StateTaxBases;
  spending: StateSpending;
  balance: number;
  surplus: number;
  stateGdp: number; // State GDP for reference
  updatedAt: Date;
}

export interface EnactedLaw {
  _id: ObjectId;
  billId: ObjectId;
  legislationTypeId: string;
  title: string;
  scope: "national" | "state";
  countryId?: string;
  stateId?: string;
  /** @deprecated Legacy percentage-of-budget cost (0-100). Use annualCostUsd for new laws. */
  budgetCost: number;
  /** Fixed annual cost in the local currency. */
  annualCostUsd?: number;
  /** Annual cost that scales with current GDP: multiplier × GDP. */
  gdpPerCapitaMultiplier?: number;
  /** Annual cost that scales with current population: amount × population. */
  annualCostPerCapita?: number;
  /**
   * Era cost model (Spec B, flag-on only). Fraction of GDP for gdpFraction-class
   * types: cost = gdpCostFraction × GDP. Never read when eraSystemEnabled is off.
   */
  gdpCostFraction?: number;
  /**
   * Era cost model (Spec B, flag-on only). Fraction of per-capita income for
   * perCapita-class types: cost = incomeCostFraction × the GAME's live national
   * median income × population (macro-v1 Phase 1; falls back to a share-of-GDP
   * form when live income is unavailable). Never read when eraSystemEnabled is off.
   */
  incomeCostFraction?: number;
  /** Tax rate (%) for tax-rate legislation types. */
  rate?: number;
  /** Index of the enacted policy option within the legislation type's policyOptions array. */
  policyOptionIndex?: number;
  /**
   * Political-legislation v2 cost model (spec §5.1) — presence is the
   * generation discriminator; routing prices it through the new cost engine on
   * the rollup base. Legacy flat fraction fields above are never written on
   * new-generation records.
   */
  costModelV2?: {
    gdpCostFraction?: number;
    incomeCostFraction?: number;
    gdpRevenueFraction?: number;
  };
  /**
   * Annual law revenue (local currency) for new-generation laws. Summed from
   * scratch into `revenue.lawRevenue` on every budget sync (§5.1 idempotency
   * rule — never folded into `revenue.other`).
   */
  annualRevenueV2?: number;
  budgetCategory: string;
  enactedAt: Date;
  enactedYear: number;
  repealedAt?: Date;
  isGrant?: boolean;
  grantType?: "formula" | "discretionary";
  grantDistribution?: Record<string, number>;
  /**
   * Attribution for how this law came to be enacted. Absent/"legislature" for
   * ordinary bills (the historical default — every pre-existing row predates
   * this field). "scotus_ruling" marks a diverged Supreme Court case
   * (#3598/#3581) synthesized via the same `onBillEnacted`/`recordEnactedLaw`
   * pipeline real bills use, so it can be attributed/filtered in UI without
   * touching the shared enactment→metric-registry→lean-drift flow.
   * "scotus_surprise_ruling" (#3607) marks a procedurally-spawned, non-
   * historical surprise Docket case resolved the same way — kept as a
   * DISTINCT value rather than reusing "scotus_ruling" so financial/audit
   * trails and the case-history UI (#3605) can tell curated historical
   * rulings apart from background-probability flavor content.
   */
  source?:
    "legislature" | "scotus_ruling" | "scotus_surprise_ruling" | "uk_judicial_review_surprise";
}

export type GrantFormulaType = "population" | "poverty" | "matching" | "hybrid";

export interface FormulaGrant {
  programId: string;
  programName: string;
  poolPercentage: number;
  formulaType: GrantFormulaType;
  matchRate?: number;
  hybridWeights?: { population: number; poverty: number };
}

export interface DebtCeilingCrisis {
  _id: "debt_ceiling_crisis";
  active: boolean;
  triggeredAt?: Date;
  triggeredYear?: number;
  turnsElapsed: number;
  resolved?: boolean;
  resolvedAt?: Date;
}
