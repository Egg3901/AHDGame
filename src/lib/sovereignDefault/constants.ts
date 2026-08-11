/**
 * Sovereign default subsystem — single source of truth for tunables.
 *
 * Design reference: docs/plans/archive/2026-05/2026-05-04-sovereign-default-design.md
 *
 * Calibration provenance per section:
 *   - Trigger / market demand: D/GDP penalty curve calibrated against
 *     Greece 2010-12 (D/GDP ~150%, demand collapse below 0.7) and Japan
 *     (D/GDP ~260% with reserve-currency-style monetary autonomy keeping
 *     demand intact). Inflation/FX coefficients reproduce Argentina 2001
 *     (peso collapse + ~30% inflation) when paired.
 *   - Failed-auction trigger (3x): real-world sovereigns rarely have three
 *     consecutive truly-failed primary auctions; setting the count to 3
 *     means crisis fires in extreme stress only.
 *   - Crisis windows (12h executive, 24h per chamber): time-boxed to keep
 *     real-time gameplay from stalling. Calibration target: 1-2 game days.
 *   - Margin penalties: financial-sector multiplier 1.5x reflects the
 *     historical observation that banks bear the brunt of sovereign
 *     defaults (deposit runs, write-downs). Tier-4 multipliers (0.7x)
 *     reflect that exporters benefit from FX depreciation post-default.
 *   - Resolution-path GDP penalties (12% / 6% / 2%): chosen to make
 *     repudiate the most painful path while not bricking the country.
 *     Calibrated to Russia 1998 (~-5% over a year), Argentina 2001
 *     (~-11% over two years), Greece bailouts (~-3% per year for 4y).
 *   - Cascade depth (3 levels): empirically, sovereign-default cascades
 *     beyond 3 levels are rare (each level requires a critical-mass of
 *     bond holders going insolvent). Cap prevents runaway computation.
 *   - Recovery floor (48 turns = 2 game days): minimum time-out before
 *     bond markets reopen, matching IMF program timelines.
 *
 * All values are first-draft. Phase 10 balancing pass logs scenarios
 * against these coefficients and may adjust where outcomes are unrealistic.
 * Each rebalance should record its motivation in commits and the design doc.
 */

import type { CorporationType } from "@/lib/constants/corporations";

// ============================================================================
// Trigger / market demand (Section 3 of design)
// ============================================================================

export const BASE_DEMAND = 1.2;
export const DGDP_PENALTY_FLOOR = 0.6;
export const DGDP_PENALTY_RATE = 0.3;
export const DGDP_CLIFF_FLOOR = 2.0;
export const DGDP_CLIFF_RATE = 0.4;
export const INFLATION_PENALTY_FLOOR = 0.05;
export const INFLATION_PENALTY_RATE = 2.0;
export const FX_DEPREC_PENALTY_RATE = 1.5;
export const DEFAULT_SCAR_DURATION = 100;
export const DEFAULT_SCAR_PER_TURN = 0.01;
export const TRUST_MODIFIER_RATE = 0.4;
export const COUPON_PREMIUM_RATE = 5.0;
export const GLOBAL_BENCHMARK_RATE = 0.04;
export const FX_DEPRECIATION_LOOKBACK_TURNS = 10;

// Model B — entity participation
export const ENTITY_DEMAND_WEIGHT = 0.5;
export const ENTITY_DEMAND_CAP = 0.4;

// ============================================================================
// Failed-auction trigger
// ============================================================================

export const DEMAND_FULL_THRESHOLD = 1.0;
export const DEMAND_UNDERSUBSCRIBED_THRESHOLD = 0.7;
export const FAILED_AUCTION_COUNT_FOR_CRISIS = 3;
export const WARNING_WINDOW_TURNS = 3;

/**
 * Autonomous-world crisis eligibility (refs #3236).
 *
 * Non-player-enabled countries are normally excluded from the failed-auction →
 * crisis pipeline (the Phase 12 "Coming Soon must never default" guard in
 * crisisDetection.ts). When the world is NPP-governed (global autonomy ≥ v1)
 * there IS a governing brain that can resolve a sovereign crisis exactly like
 * player-enabled countries do (npcExecutiveAutoPropose fires immediately for
 * NPC/vacant executives), so an NPP-governed country with EXTREME fundamentals
 * is allowed through the gate.
 *
 * The band is deliberately conservative: debt/GDP must be at or beyond the
 * existing demand cliff (200%, DGDP_CLIFF_FLOOR) before a disabled country can
 * even start counting failed auctions — far above anything in the live world —
 * and the crisis itself still requires FAILED_AUCTION_COUNT_FOR_CRISIS
 * consecutive annual auction failures on top. Below the band, disabled-country
 * behavior is unchanged.
 */
export const AUTONOMOUS_CRISIS_MIN_DEBT_TO_GDP = 2.0;

// ============================================================================
// Crisis windows — resolved turn-first (freeze on pause; don't drift with the
// game clock). The `_TURNS` values are the source of truth for resolution; the
// `_HOURS` values are kept for the wall-clock display/fallback and equal the
// turn counts at the standard 1-turn-per-hour cadence.
// ============================================================================

export const EXECUTIVE_DECISION_HOURS = 12;
export const EXECUTIVE_DECISION_TURNS = 12;
export const LEGISLATIVE_VOTE_HOURS_PER_CHAMBER = 24;
export const LEGISLATIVE_VOTE_TURNS_PER_CHAMBER = 24;
export const SOVEREIGN_CRISIS_BILL_TYPE = "moneyBill" as const;
export const SOVEREIGN_CRISIS_AUTO_SIGN_DEFAULT = true;

// ============================================================================
// Monetize gating
// ============================================================================

export const MONETIZE_GATE_INFLATION = 0.08;
export const INFLATION_SHOCK_MULTIPLIER = 5.0;

// ============================================================================
// IMF sovereign bailout facility
// ============================================================================

export const IMF_SOVEREIGN_DEFAULT_RATE = 0.06; // 6% annual
export const IMF_SOVEREIGN_AMORTIZATION_TURNS = 240;
export const IMF_SOVEREIGN_INCOME_CAPTURE_MIN = 0.1;
export const IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT = 0.2;
export const IMF_SOVEREIGN_INCOME_CAPTURE_CAP = 0.3;
export const IMF_BOARD_OVERRIDE_WINDOW_HOURS = 12;
export const IMF_BOARD_OVERRIDE_WINDOW_TURNS = 12;
export const IMF_BOARD_RATE_DELTA_BOUND = 0.02;
export const IMF_BOARD_CAPTURE_DELTA_BOUND = 0.1;
export const IMF_BOARD_PUBLIC_TRUST_DELTA = 0.02;

// ============================================================================
// Recovery
// ============================================================================

export const RECOVERY_FLOOR_TURNS = 48;
export const RECOVERY_DISCIPLINE_REQUIRED_STREAK = 5;
export const RECOVERY_DISCIPLINE_RECHECK_TURNS = 5;

/**
 * Phase 11a recovery credibility bonus: when a country exits recovery cleanly
 * (5-streak fiscal-discipline target), discount its effective sovereign coupon
 * rate by RECOVERY_CREDIBILITY_RATE_DISCOUNT pp for this many turns.
 */
export const RECOVERY_CREDIBILITY_BONUS_TURNS = 100;
/** Percentage-point discount applied to sovereign coupon rate while bonus is active. */
export const RECOVERY_CREDIBILITY_RATE_DISCOUNT = 0.5;

// ============================================================================
// Margin penalties (post-1.5x bump per design Q&A)
// ============================================================================

export const DEFAULT_MARGIN_PENALTY_REPUDIATE = -0.18;
export const DEFAULT_MARGIN_PENALTY_RESTRUCTURE = -0.09;
export const DEFAULT_MARGIN_PENALTY_BAILOUT = -0.045;
export const DEFAULT_MARGIN_PENALTY_MONETIZE = 0.0; // handled by inflation pipeline
export const DEFAULT_MARGIN_FULL_PENALTY_TURNS = 48;
export const DEFAULT_MARGIN_DECAY_TURNS = 24;
// Total margin window = 72 turns

export const DEFAULT_MARGIN_SECTOR_MULTIPLIERS: Record<CorporationType, number> = {
  // Tier 1 (1.5x) — heaviest losers
  financial: 1.5,
  // Tier 2 (1.3x) — FX/import-sensitive, leverage-dependent, consumer-facing
  manufacturing: 1.3,
  retail: 1.3,
  automobiles: 1.3,
  chemical_industries: 1.3,
  real_estate: 1.3,
  construction: 1.3,
  // Tier 3 (1.0x) — mixed-exposure baseline
  technology: 1.0,
  telecommunications: 1.0,
  healthcare: 1.0,
  media: 1.0,
  entertainment: 1.0,
  logistics: 1.0,
  defense: 1.0,
  // Tier 4 (0.7x) — export-positive, partial winners
  energy: 0.7,
  extraction: 0.7,
  agriculture: 0.7,
};

// ============================================================================
// Resolution-path specifics
// ============================================================================

// Repudiate
export const REPUDIATE_GDP_PENALTY = 0.12; // -12%
export const REPUDIATE_GDP_PENALTY_TURNS = 3;
export const REPUDIATE_FX_DEPRECIATION = 0.4;
export const REPUDIATE_TRUST_HIT = -0.3;
export const REPUDIATE_BOND_MARKET_PRICE = 0.05;
export const REPUDIATE_LOCKOUT_TURNS = 48;
/**
 * Fraction of the sovereign's OWN debt ledger (`federalBudget.treasuryBalance`
 * / `debt.principal`) wiped by a repudiation (refs #3813). Mirrors the
 * REPUDIATE_BOND_MARKET_PRICE haircut dealt to individual bondholders — the
 * country's own recognized liability should shrink by the same story (95%
 * gone, a small residual remains so a repudiating country isn't handed a
 * literal clean slate). Without this, `markCountryBondsRepudiated` haircuts
 * only the tradeable `bonds` collection; the aggregate ledger that drives the
 * interest-rate tier and debt/GDP ratio every turn (`deriveFiscalState`) never
 * shrinks, so the very next `processTreasuryTurn` tick recomputes the same
 * CCC/14% tier and the spiral resumes untouched by the "default."
 */
export const REPUDIATE_PRINCIPAL_WRITEDOWN = 1 - REPUDIATE_BOND_MARKET_PRICE;

// Restructure
export const RESTRUCTURE_HAIRCUT = 0.4;
export const RESTRUCTURE_MATURITY_EXTENSION_TURNS = 60;
export const RESTRUCTURE_GDP_PENALTY = 0.06;
export const RESTRUCTURE_GDP_PENALTY_TURNS = 2;
export const RESTRUCTURE_FX_DEPRECIATION = 0.15;
export const RESTRUCTURE_TRUST_HIT = -0.15;
export const RESTRUCTURE_BOND_MARKET_PRICE = 0.6;
export const RESTRUCTURE_LOCKOUT_TURNS = 16;

// Bailout
export const BAILOUT_DIRECT_GDP_PENALTY = 0.02;
// Remaining ~3% emergent from existing budget→metrics pipeline

// ============================================================================
// Cascade
// ============================================================================

export const MASS_CASCADE_THRESHOLD = 5;
export const CASCADE_MAX_LEVELS = 3;

/**
 * Global contagion multiplier for the sector-margin penalty. Foreign corps
 * absorb `localPenalty × (defaultingCountry.gdp / globalGdp) × this`. So a
 * country that is 40% of global GDP defaulting at base penalty -18% projects
 * (-0.18 × 0.4 × 0.5) = -3.6% onto foreign sector margins (before sector
 * multiplier and decay).
 */
export const GLOBAL_CONTAGION_MULTIPLIER = 0.5;

// ============================================================================
// Debt Sustainability Index (DSA) — Phase 11a
// ============================================================================
//
// Calibrated to reproduce real-world thresholds: 60% D/GDP starts penalizing,
// 200% reaches max penalty (Japan-like). Primary surplus 3% caps bonus
// (Germany-like). FX depreciation > 25% over 10t = max penalty (Argentina-like).
// Recession at 3%+ contraction caps penalty (Greece-like). Tunable.

export const DSA_BASELINE_SCORE = 80;
export const DSA_DGDP_FLOOR = 0.6;
export const DSA_DGDP_CEILING = 2.0;
export const DSA_DGDP_MAX_PENALTY = 50;
export const DSA_PRIMARY_SURPLUS_BONUS_CAP = 15;
export const DSA_PRIMARY_DEFICIT_PENALTY_CAP = 25;
export const DSA_PRIMARY_BALANCE_RATE = 500; // pts per unit ratio
export const DSA_FX_THRESHOLD = 0.05;
export const DSA_FX_CEILING = 0.25;
export const DSA_FX_MAX_PENALTY = 25;
export const DSA_GROWTH_BONUS_CAP = 10;
export const DSA_GROWTH_PENALTY_CAP = 25;
export const DSA_GROWTH_RATE_BONUS = 333; // pts per unit fraction
export const DSA_GROWTH_RATE_PENALTY = 833;
