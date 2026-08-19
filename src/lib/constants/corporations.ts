import type { StateMetrics } from "@/lib/db/types";
import type {
  StateMetricMarginContribution,
  StateMetricMarginOverride,
} from "@/lib/corporations/stateMetricMarginTypes";
import {
  INVESTOR_CONFIDENCE_BASELINE,
  EXPROPRIATION_RISK_MARGIN_MAX,
} from "@/lib/nationalization/constants";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

/**
 * Corporation system constants.
 * Sector types, costs, labels, and financial parameters.
 */

export const CORPORATION_TYPES = [
  "financial",
  "media",
  "manufacturing",
  "chemical_industries",
  "healthcare",
  "retail",
  "automobiles",
  "technology",
  "energy",
  "agriculture",
  "real_estate",
  "construction",
  "defense",
  "telecommunications",
  "entertainment",
  "logistics",
  "extraction",
] as const;

export type CorporationType = (typeof CORPORATION_TYPES)[number];

export const CORPORATION_TYPE_LABELS: Record<CorporationType, string> = {
  financial: "Financial",
  media: "Media",
  manufacturing: "Manufacturing",
  chemical_industries: "Chemical Industries",
  healthcare: "Healthcare",
  retail: "Retail",
  automobiles: "Automobiles",
  technology: "Technology",
  energy: "Energy",
  agriculture: "Agriculture",
  real_estate: "Real Estate",
  construction: "Construction",
  defense: "Defense",
  telecommunications: "Telecommunications",
  entertainment: "Entertainment",
  logistics: "Logistics",
  extraction: "Extraction & Mining",
};

/** Cost deducted from character funds to found a corporation */
export const CORPORATION_FOUNDING_COST = 1_000_000;

/**
 * CEO salary is capped at this multiple of the corporation's gross revenue.
 * Gross revenue = sum of sector revenue only; bond proceeds and bond coupon
 * income are excluded, so issuing bonds can never raise the salary ceiling.
 * At zero gross revenue the cap is $0 (Bug #0728).
 */
export const CEO_SALARY_MAX_REVENUE_MULTIPLE = 1.25;

/** A user may found at most one corporation per this many turns (Bug #0728). */
export const CORPORATION_FOUNDING_COOLDOWN_TURNS = 168;

/** Default starting liquid capital for a new corporation */
export const CORPORATION_STARTING_CAPITAL = 1_000_000;

/** Minimum starting capital the founder may commit to the corporation's treasury at founding */
export const MIN_CORPORATION_STARTING_CAPITAL = 1_000_000;

/** Maximum starting capital the founder may commit to the corporation's treasury at founding */
export const MAX_CORPORATION_STARTING_CAPITAL = 50_000_000;

/**
 * Fraction of a dissolving corp's sector NPV that is recoverable as cash in a
 * bond-default liquidation. On dissolution the sectors are abandoned to the
 * unowned market (no buyer pays), so paying out their full going-concern NPV
 * minted the corp's enterprise value — the money-laundering exploit. A salvage
 * haircut models a fire-sale: dissolution still returns something, but far less
 * than the capitalized future earnings. Applies ONLY to the liquidation payout
 * (previewDissolveSettlement), never to solvency / credit-rating equity.
 */
export const DISSOLUTION_SECTOR_SALVAGE_FRACTION = 0.2;

/**
 * Fraction of a sector's going-concern NPV recovered as cash when sectors are
 * liquidated to cure a bond default via RESTRUCTURING (not dissolution).
 *
 * Unlike dissolution (sectors abandoned to the unowned market at a fire-sale
 * {@link DISSOLUTION_SECTOR_SALVAGE_FRACTION}), restructuring is an orderly,
 * CEO-directed (or turn-tick-forced) sale of just enough sectors to pay
 * bondholders in full while the corporation survives. It is deliberately the
 * *rewarded* path — recovering 85% of NPV — so a solvent-enough corp restructures
 * rather than defaulting-and-walking or dissolving. Applies ONLY to the
 * restructuring liquidation proceeds, never to solvency / credit-rating equity.
 */
export const RESTRUCTURE_SECTOR_SALVAGE_FRACTION = 0.85;

/**
 * Minimum age, in turns, a corporation must reach before a player may dissolve
 * it (quick-dissolve, public-corp dissolution vote, or bond-default settle).
 * Blocks the found → dissolve churn loop. Admin force-liquidate is exempt.
 * Measured as `currentTurn − foundedAtTurn`; corps with no `foundedAtTurn`
 * (founded before that field existed) are exempt.
 */
export const MIN_CORPORATION_DISSOLUTION_AGE_TURNS = 24;

/** Fraction of market capitalization charged to relocate corporate headquarters */
export const RELOCATION_COST_FRACTION = 0.07;

/** Multiplier applied to base relocation cost when the HQ crosses into a new country */
export const CROSS_COUNTRY_RELOCATION_MULTIPLIER = 2;

/** Flat cost in anchor currency (₳) to rename a corporation */
export const CORPORATION_RENAME_COST = 500_000;

/** Fraction of current marketing strength lost on rename (25%) */
export const CORPORATION_RENAME_MS_PENALTY = 0.25;

/** Cooldown between renames - matches type-switch cooldown (48 turns = 1 game year / 2 real days) */
export const CORPORATION_RENAME_COOLDOWN_TURNS = 48;

/** Cost to expand into a new state (deducted from corporation liquid capital) */
export const SECTOR_EXPANSION_BASE_COST = 100_000;

/** Number of shares issued to CEO when founding a corporation */
export const CEO_INITIAL_SHARES = 10_000_000;

/** Minimum total shares after a CEO-only reverse split (consolidation) */
export const SHARE_CONSOLIDATION_MIN_TOTAL_SHARES = 1_000_000;

/** Turns between CEO stock splits / reverse splits (same cooldown for both) */
export const SHARE_STRUCTURE_COOLDOWN_TURNS = 48;

/**
 * A corporation's own CEO may acquire at most this fraction of the corp's total
 * shares within a trailing CEO_SELF_ACQUISITION_WINDOW_TURNS window, summed
 * across public-float buys and purchases from other characters (self-issuance
 * excluded). Throttles the share pump-dump cycle. Surfaced to players.
 * Private corporations are exempt: they have no public float, and a sitting
 * CEO buying a controlling private block is a transfer, not a market pump.
 */
export const CEO_SELF_ACQUISITION_CAP_FRACTION = 0.1;
export const CEO_SELF_ACQUISITION_WINDOW_TURNS = 120;

/** Forward split: new total cannot exceed old total × this factor */
export const MAX_FORWARD_SHARE_SPLIT_MULTIPLIER = 100;

/**
 * Number of turns AFTER a stock split / reverse split during which the share-price
 * formula blends previous price toward fundamental at STOCK_SPLIT_SMOOTHING_PREV_WEIGHT
 * instead of applying the normal per-turn rate limiter. The consolidate route writes
 * a cap-preserving scaled price; without this window the next fundamental would
 * overwrite that scaling in one turn.
 *
 * Counted as `currentTurn - lastShareStructureTurn`. So `0` means "the same turn
 * the split happened", `1` means "the next turn after the split", etc. Setting
 * this to 2 means the blend applies for the split turn + 2 turns after = 3 total
 * turns of slow drift before the rate limiter resumes.
 */
export const STOCK_SPLIT_PRICE_SMOOTHING_TURNS = 2;

/**
 * Weight on previous price during the post-split cooldown. Price =
 * PREV * previous + (1 - PREV) * fundamental, so the just-scaled price
 * dominates while still tracking genuine fundamental moves.
 */
export const STOCK_SPLIT_SMOOTHING_PREV_WEIGHT = 0.7;
export const STOCK_SPLIT_SMOOTHING_BSP_WEIGHT = 0.2;
export const STOCK_SPLIT_SMOOTHING_INCOME_WEIGHT = 0.1;

/**
 * Maximum single-turn fractional change in a corp's fundamental share price
 * (±35%). Prevents the unbounded knife-edge snap-back that occurs when issued
 * bond debt crosses total assets and equity flips through zero (issue #2888):
 * without this the price could move ~200x in one turn. The move direction is
 * preserved and the price still converges to the true fundamental, just over
 * several turns instead of one snap. NOTE: a judgment-call magnitude — validate
 * with a worldsim A/B before treating as final.
 */
export const SHARE_PRICE_MAX_TURN_MOVE = 0.35;

/**
 * Rate limiter is skipped when the previous share price is at or below this
 * value ($1.00). Genuinely-recovering penny corps must be free to climb off the
 * floor quickly rather than being pinned by a ±35% band anchored near $0.
 */
export const SHARE_PRICE_RATE_LIMIT_MIN_PREV = 1.0;

/** Default share price when a corporation is founded ($) */
export const DEFAULT_SHARE_PRICE = 0.1;

/** Base marketing strength gained per turn when any marketing budget is set */
export const MARKETING_BASE_GAIN_PER_TURN = 1.0;

/** Scaling coefficient for log-based budget scaling */
export const MARKETING_BUDGET_SCALE = 0.65;

/** Marketing strength threshold where diminishing returns double */
export const MARKETING_DIMINISHING_THRESHOLD = 100;

/**
 * Calculate marketing strength growth per turn.
 * - Base gain of 1 MS/turn if any spending
 * - Budget scaling: 0.65 × ln(1 + budget/100k) — strong diminishing at high spend
 *   $100k → ~1.5/turn, $2M → ~3/turn, $10M → ~4/turn
 * - Stored MS diminishing: 100/(100 + ms + excess), doubles past 100 MS
 */
export function calcMarketingGrowth(dailyBudget: number, currentStrength: number): number {
  if (dailyBudget <= 0) return 0;
  const base = MARKETING_BASE_GAIN_PER_TURN;
  const scaled = MARKETING_BUDGET_SCALE * Math.log(1 + dailyBudget / 100_000);
  const raw = base + scaled;
  // Diminishing returns on stored MS; doubles past the threshold
  const excess = Math.max(0, currentStrength - MARKETING_DIMINISHING_THRESHOLD);
  const diminishing =
    MARKETING_DIMINISHING_THRESHOLD / (MARKETING_DIMINISHING_THRESHOLD + currentStrength + excess);
  return raw * diminishing;
}

/** Profit margin bonus (%) for sectors in corporation's home state */
export const HOME_STATE_MARGIN_BONUS = 10;
/** Profit margin bonus (%) for sectors in corporation's home nation (same country, different state) */
export const HOME_NATION_MARGIN_BONUS = 5;
/** Profit margin bonus (%) for a state/region's primary sector specialization */
export const STATE_PRIMARY_SECTOR_MARGIN_BONUS = 10;
/** Profit margin bonus (%) for a state/region's secondary sector specialization */
export const STATE_SECONDARY_SECTOR_MARGIN_BONUS = 5;

/** Default profit margin for new sectors (%) */
export const DEFAULT_PROFIT_MARGIN = 35;

/**
 * Effective margin was previously clamped with a hard `Math.min(100, ...)`. That
 * made 100% a flat target a player could deliberately pin against by stacking
 * additive modifiers (home-state +10, state-primary spec +10, subsidy, tech
 * marginBonus, export premium, favourable commodity) — every point past the cap
 * was free, so the optimal play was to pile modifiers until the sector ran at
 * zero marginal cost. The soft cap below keeps margin strictly monotonic in the
 * stacked total but bends the top of the curve so the last points cost more and
 * the sector asymptotes toward, without ever reaching, the ceiling. Nothing
 * changes below the knee, so ordinary sectors are byte-identical.
 */
/** Margin (%) below which no compression happens — the linear region. */
export const MARGIN_SOFT_CAP_KNEE = 80;
/** Ceiling (%) the compressed region asymptotes toward but never reaches. */
export const MARGIN_HARD_CEILING = 100;

/**
 * Soft-cap an additive margin stack. At or below {@link MARGIN_SOFT_CAP_KNEE}
 * the value is returned unchanged (and negative margins pass straight through —
 * loss-makers still drain cash). Above the knee the excess is compressed with a
 * tanh so the result rises monotonically toward {@link MARGIN_HARD_CEILING}
 * without a flat target to pin against. C1-continuous at the knee (tanh'(0)=1),
 * so there is no kink where compression begins.
 */
export function softCapEffectiveMargin(rawMargin: number): number {
  if (!Number.isFinite(rawMargin)) return 0;
  if (rawMargin <= MARGIN_SOFT_CAP_KNEE) return rawMargin;
  const span = MARGIN_HARD_CEILING - MARGIN_SOFT_CAP_KNEE;
  return MARGIN_SOFT_CAP_KNEE + span * Math.tanh((rawMargin - MARGIN_SOFT_CAP_KNEE) / span);
}

/** Default starting revenue for a new sector */
export const DEFAULT_SECTOR_STARTING_REVENUE = 1_000_000;

/** Default starting workers for a new sector */
export const DEFAULT_SECTOR_STARTING_WORKERS = 500;

/**
 * Revenue generated per worker (daily rate).
 * At $1M revenue → 50,000 workers. At $10M → 500,000.
 *
 * This anchor is purely a DISPLAY scale for the sector headcount: `workers` is
 * consumed only as a ratio-weight in the wage/automation indices (scale-cancels)
 * and proportionally in worker-shedding — actual labour cost is revenue-based,
 * and nothing sums headcount into population or unemployment. Lowered from 2_000
 * to 20 so a whole regional industry reads as tens of thousands of jobs instead
 * of a few hundred. Kept in lockstep with `CAPACITY_REVENUE_PER_WORKER`.
 */
const REVENUE_PER_WORKER = 20;

/**
 * Maximum workforce skill adjustment to worker count (±30%).
 * At skill=100: workers × 0.70 (highly productive, fewer needed).
 * At skill=0: workers × 1.30 (unskilled, more needed).
 * At skill=50: workers × 1.00 (neutral).
 */
const WORKFORCE_SKILL_WORKER_MAX_ADJUSTMENT = 0.3;

/**
 * Calculate the number of workers for a sector based on revenue and
 * the state's workforce skill metric.
 *
 * @param revenue - Sector's daily revenue
 * @param workforceSkill - State's workforce skill metric (0–100, null defaults to 50)
 * @returns Number of workers (integer, minimum 1)
 */
export function calculateWorkers(
  revenue: number,
  workforceSkill: number | null | undefined
): number {
  const baseWorkers = revenue / REVENUE_PER_WORKER;
  const skill = workforceSkill ?? 50;
  const clamped = Math.max(0, Math.min(100, skill));
  // skill 50 → multiplier 1.0, skill 100 → 0.70, skill 0 → 1.30
  const skillMultiplier = 1 - ((clamped - 50) / 50) * WORKFORCE_SKILL_WORKER_MAX_ADJUSTMENT;
  return Math.max(1, Math.round(baseWorkers * skillMultiplier));
}

/** Growth cost multiplier — growthCost = revenue × growthRate × this */
export const GROWTH_COST_MULTIPLIER = 3.0;

// ─── Market Dominance Modifiers ──────────────────────────────────────────────
// Sectors that exceed DOMINANCE_MARKET_SHARE_THRESHOLD of their (state, sectorType)
// market face four penalties: more expensive growth, weaker defence against
// attacks, lower margins, and a passive regulatory burden on revenue. All four
// start at zero extra cost exactly at the threshold (no cliff) and ramp
// continuously to their "full" value at 100% market share. The multiplicative
// penalties (growth cost, attack ease) follow a convex curve via
// DOMINANCE_RAMP_EXPONENT: gentle through the low-dominance band (~50–66%, where
// holding a lead stays cash-positive and a slow grind upward is affordable) and
// increasingly punishing toward monopoly. The additive penalties (margin,
// regulatory burden) ramp linearly from the threshold. The earlier design used
// a deliberate discontinuity at 50%; it made dominance feel like a wall —
// crossing the line instantly flipped growth cash-negative — so the cliff was
// replaced with this smooth, back-loaded ramp.

/** Market-share threshold (%) above which a sector becomes "dominant". */
export const DOMINANCE_MARKET_SHARE_THRESHOLD = 50;

/**
 * NATIONAL dominance threshold (%). The per-cell threshold above is a *local*
 * contest — 50% of one (state, sectorType). But a corp can hold a commanding
 * share of an entire country's sector while sitting below 50% in every single
 * state (spread thin, each cell legal, the nation an effective oligopolist).
 * National share is a market-weighted average of the cell shares, so it is
 * always <= the largest cell - a same-50%-threshold national toll could never
 * fire. This lower threshold is what makes national market power tollable: 30%
 * of a whole country's sector is real concentration even with no local monopoly.
 * The turn charges the HARSHER of the local and national tolls, never both.
 */
export const DOMINANCE_NATIONAL_SHARE_THRESHOLD = 30;

/**
 * Convexity of the multiplicative dominance ramps (growth cost, attack ease).
 * Penalties scale with (share-progress)^EXPONENT, so a value >1 back-loads the
 * cost toward higher market share: ~50–66% is lightly penalised (dominance is
 * maintainable but expensive) while pushing toward 100% bites hard. At 1.0 the
 * ramp is linear; at 2.0 a sector at 66% pays only ~10% of the full growth-cost
 * premium, versus ~64% at 90%.
 */
export const DOMINANCE_RAMP_EXPONENT = 2;

/** Growth-cost multiplier at 100% share (1.0× at the threshold, convex ramp between). */
export const DOMINANCE_GROWTH_COST_MULT_AT_FULL = 3.0;

/** Attack-capture multiplier at 100% share (1.0× at the threshold, convex ramp between). */
export const DOMINANCE_ATTACK_EASE_MULT_AT_FULL = 3.5;

/** Margin penalty (percentage points) applied just above the dominance threshold. */
export const DOMINANCE_MARGIN_PENALTY_AT_THRESHOLD = 0;

/**
 * Margin penalty (percentage points) at 100% market share. Models the
 * regulatory pressure, customer backlash, unionisation, and political risk a
 * monopolist accumulates as it tightens its grip on a sector.
 */
export const DOMINANCE_MARGIN_PENALTY_AT_FULL = -15;

/**
 * Regulatory burden as a fraction of hourly revenue at the dominance threshold.
 * Deducted as a passive cost (compliance, antitrust legal, lobbying).
 */
export const DOMINANCE_REGULATORY_BURDEN_AT_THRESHOLD = 0;

/**
 * Regulatory burden as a fraction of hourly revenue at 100% market share.
 * 5% of revenue is meaningful but not crippling — a sector is still profitable
 * at 100% share, just less so.
 */
export const DOMINANCE_REGULATORY_BURDEN_AT_FULL = 0.05;

/**
 * Rival corps in the same (state, sectorType) cell at which the dominance toll
 * is charged in full. At or above this count the market is "crowded" and a
 * dominant corp pays the undiscounted price.
 */
export const DOMINANCE_DENSITY_CROWDED_COMPETITORS = 4;

/**
 * Share of the dominance toll charged in a market with NO rivals at all.
 * A corp that is the only firm in a small state has not out-competed anyone —
 * it turned up somewhere nobody else wanted to be. Charging it the same
 * expansion toll as a corp that fought four rivals for California left thin
 * markets permanently unbuilt even where demand existed.
 */
export const DOMINANCE_DENSITY_MIN_FACTOR = 0.35;

/**
 * Scales the dominance toll by how contested the market actually is.
 *
 * Returns {@link DOMINANCE_DENSITY_MIN_FACTOR} with no rivals, ramping linearly
 * to 1 at {@link DOMINANCE_DENSITY_CROWDED_COMPETITORS}. Applied to the toll's
 * EXCESS over 1.0, never to the base price, so a market with no rivals still
 * pays a real (if smaller) monopoly premium and the ramp stays continuous.
 *
 * `competitorCount` counts distinct rival CORPORATIONS holding a sector in the
 * cell, excluding the building corp's own. Absent/invalid ⇒ crowded (factor 1),
 * so a caller that cannot resolve density never gets a silent discount.
 */
export function dominanceDensityFactor(competitorCount: number | null | undefined): number {
  if (!Number.isFinite(competitorCount as number) || (competitorCount as number) < 0) return 1;
  const rivals = Math.min(competitorCount as number, DOMINANCE_DENSITY_CROWDED_COMPETITORS);
  const t = rivals / DOMINANCE_DENSITY_CROWDED_COMPETITORS;
  return DOMINANCE_DENSITY_MIN_FACTOR + (1 - DOMINANCE_DENSITY_MIN_FACTOR) * t;
}

function dominanceMultiplier(
  marketSharePercent: number,
  atFull: number,
  threshold: number = DOMINANCE_MARKET_SHARE_THRESHOLD
): number {
  const share = Math.max(0, Math.min(100, marketSharePercent));
  if (share <= threshold) return 1;
  const range = 100 - threshold;
  const t = (share - threshold) / range;
  // Convex ramp from 1.0× at the threshold to atFull× at 100% share — continuous
  // (no cliff), with the cost back-loaded toward monopoly via DOMINANCE_RAMP_EXPONENT.
  return 1 + (atFull - 1) * Math.pow(t, DOMINANCE_RAMP_EXPONENT);
}

/**
 * Linear scaling helper for dominance modifiers that should return 0 below the
 * threshold (rather than 1.0×). Used by the margin-penalty and regulatory-
 * burden helpers, which are additive rather than multiplicative.
 */
function dominanceAdditive(
  marketSharePercent: number,
  atThreshold: number,
  atFull: number,
  threshold: number = DOMINANCE_MARKET_SHARE_THRESHOLD
): number {
  const share = Math.max(0, Math.min(100, marketSharePercent));
  if (share <= threshold) return 0;
  const range = 100 - threshold;
  const t = (share - threshold) / range;
  return atThreshold + t * (atFull - atThreshold);
}

/**
 * Growth-cost multiplier for a sector based on its market share within its
 * (state, sectorType). Returns 1.0 at or below the threshold and ramps convexly
 * (see {@link DOMINANCE_RAMP_EXPONENT}) to
 * {@link DOMINANCE_GROWTH_COST_MULT_AT_FULL} at 100% — no discontinuity at the
 * threshold, so a sector can cross into dominance without a sudden cost wall.
 */
export function getDominanceGrowthCostMultiplier(marketSharePercent: number): number {
  return dominanceMultiplier(marketSharePercent, DOMINANCE_GROWTH_COST_MULT_AT_FULL);
}

/**
 * Attack-capture multiplier when a rival corp attacks this sector. 1.0 at or
 * below the threshold, ramping convexly (see {@link DOMINANCE_RAMP_EXPONENT})
 * to {@link DOMINANCE_ATTACK_EASE_MULT_AT_FULL} at 100% share. Multiplied into
 * the contested fraction so a sector grows steadily more vulnerable as it nears
 * monopoly, rather than becoming sharply easier to attack the instant it crosses
 * the threshold.
 */
export function getDominanceAttackEaseMultiplier(marketSharePercent: number): number {
  return dominanceMultiplier(marketSharePercent, DOMINANCE_ATTACK_EASE_MULT_AT_FULL);
}

/**
 * Margin penalty (percentage points) for a sector based on its market share.
 * 0 at or below the dominance threshold, scaling linearly to
 * {@link DOMINANCE_MARGIN_PENALTY_AT_FULL} at 100% share. Summed into the
 * sector's effective margin alongside the other modifiers.
 */
export function getDominanceMarginPenalty(marketSharePercent: number): number {
  return dominanceAdditive(
    marketSharePercent,
    DOMINANCE_MARGIN_PENALTY_AT_THRESHOLD,
    DOMINANCE_MARGIN_PENALTY_AT_FULL
  );
}

/**
 * Fraction of hourly revenue a dominant sector pays as a passive regulatory
 * burden (compliance, antitrust legal, lobbying). Returns 0 at or below the
 * threshold, scaling linearly to {@link DOMINANCE_REGULATORY_BURDEN_AT_FULL}
 * at 100% share. Deducted from sector revenue before profit is computed —
 * separate from margin so the diagnostic UI can show it independently.
 */
export function getDominanceRegulatoryBurden(marketSharePercent: number): number {
  return dominanceAdditive(
    marketSharePercent,
    DOMINANCE_REGULATORY_BURDEN_AT_THRESHOLD,
    DOMINANCE_REGULATORY_BURDEN_AT_FULL
  );
}

/**
 * National-share twins of the dominance tolls: same ramp shape and same
 * at-full magnitudes, but starting from {@link DOMINANCE_NATIONAL_SHARE_THRESHOLD}
 * (30%) instead of the per-cell 50%. These charge on a corp's aggregate share of
 * a whole (country, sectorType). The turn takes the HARSHER of each local and
 * national toll (min for the negative margin penalty, max for the positive
 * growth-cost multiplier and regulatory burden) so a nationally dominant corp
 * cannot escape antitrust by staying under 50% in every individual state.
 */
export function getNationalDominanceMarginPenalty(nationalSharePercent: number): number {
  return dominanceAdditive(
    nationalSharePercent,
    DOMINANCE_MARGIN_PENALTY_AT_THRESHOLD,
    DOMINANCE_MARGIN_PENALTY_AT_FULL,
    DOMINANCE_NATIONAL_SHARE_THRESHOLD
  );
}

export function getNationalDominanceRegulatoryBurden(nationalSharePercent: number): number {
  return dominanceAdditive(
    nationalSharePercent,
    DOMINANCE_REGULATORY_BURDEN_AT_THRESHOLD,
    DOMINANCE_REGULATORY_BURDEN_AT_FULL,
    DOMINANCE_NATIONAL_SHARE_THRESHOLD
  );
}

export function getNationalDominanceGrowthCostMultiplier(nationalSharePercent: number): number {
  return dominanceMultiplier(
    nationalSharePercent,
    DOMINANCE_GROWTH_COST_MULT_AT_FULL,
    DOMINANCE_NATIONAL_SHARE_THRESHOLD
  );
}

// ─── Underdog attack amplifier ────────────────────────────────────────────────
// Stacks multiplicatively with `getDominanceAttackEaseMultiplier` to give small
// corps a real chance to break up entrenched monopolies. The amplifier only
// activates when the attacker is materially smaller than the defender — both
// the "small attacker" and "dominant defender" gates must be met.

/** Defender market share (%) above which the underdog amplifier engages. */
export const UNDERDOG_DEFENDER_MIN_SHARE = 50;

/** Attacker market share (%) at or below which the full underdog bonus applies. */
export const UNDERDOG_ATTACKER_FULL_BONUS_SHARE = 10;

/** Attacker market share (%) above which the underdog bonus is fully withdrawn. */
export const UNDERDOG_ATTACKER_NO_BONUS_SHARE = 25;

/** Maximum underdog amplifier (multiplicative on top of dominance multiplier). */
export const UNDERDOG_AMPLIFIER_MAX = 1.75;

/**
 * Underdog amplifier on attack capture. Returns 1.0× (no bonus) unless the
 * defender is dominant (>{@link UNDERDOG_DEFENDER_MIN_SHARE}%) AND the attacker
 * is materially smaller (<{@link UNDERDOG_ATTACKER_NO_BONUS_SHARE}%) in the
 * same (state, sectorType) cell. Below {@link UNDERDOG_ATTACKER_FULL_BONUS_SHARE}%
 * the attacker gets the full {@link UNDERDOG_AMPLIFIER_MAX}; between the two
 * thresholds the bonus tapers linearly to 1.0×.
 */
export function getUnderdogAttackAmplifier(
  attackerSharePercent: number,
  defenderSharePercent: number
): number {
  if (defenderSharePercent <= UNDERDOG_DEFENDER_MIN_SHARE) return 1;
  if (attackerSharePercent >= UNDERDOG_ATTACKER_NO_BONUS_SHARE) return 1;
  if (attackerSharePercent <= UNDERDOG_ATTACKER_FULL_BONUS_SHARE) return UNDERDOG_AMPLIFIER_MAX;
  // Linear taper from full bonus to 1.0× across the gap.
  const t =
    (UNDERDOG_ATTACKER_NO_BONUS_SHARE - attackerSharePercent) /
    (UNDERDOG_ATTACKER_NO_BONUS_SHARE - UNDERDOG_ATTACKER_FULL_BONUS_SHARE);
  return 1 + (UNDERDOG_AMPLIFIER_MAX - 1) * t;
}

// ─── Sustained negative production penalty ───────────────────────────────────
// A sector that has held `productionPolicyLevel < 0` for many turns accumulates
// an escalating margin penalty. The tracker is a counter on the sector that
// increments by 1 per turn while negative and decrements by 1 per turn while
// non-negative, so a player who briefly dipped negative recovers gradually
// rather than getting a free reset.

/** Grace period (turns) before the negative-production penalty starts biting. */
export const SUSTAINED_NEGATIVE_PRODUCTION_GRACE_TURNS = 48;

/** Sustained-counter value (turns) at which the full penalty applies. */
export const SUSTAINED_NEGATIVE_PRODUCTION_FULL_TURNS = 144;

/** Maximum margin penalty (percentage points) at the full-turns threshold. */
export const SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY = -45;

/**
 * Margin penalty for a sector that has been at `productionPolicyLevel < 0` for
 * `turnsSustained` turns (the counter increments while negative, decrements
 * while non-negative, floored at 0). Returns 0 if the current policy level is
 * non-negative (no penalty once corrected) or within the grace period; scales
 * linearly to {@link SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY} at the full
 * threshold; clamped beyond.
 */
export function getSustainedNegativeProductionPenalty(
  turnsSustained: number,
  currentPolicyLevel: number
): number {
  // Penalty clears immediately when policy is no longer negative
  if (currentPolicyLevel >= 0) return 0;

  const t = Math.max(0, turnsSustained);
  if (t <= SUSTAINED_NEGATIVE_PRODUCTION_GRACE_TURNS) return 0;
  if (t >= SUSTAINED_NEGATIVE_PRODUCTION_FULL_TURNS) {
    return SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY;
  }
  const range =
    SUSTAINED_NEGATIVE_PRODUCTION_FULL_TURNS - SUSTAINED_NEGATIVE_PRODUCTION_GRACE_TURNS;
  const progress = (t - SUSTAINED_NEGATIVE_PRODUCTION_GRACE_TURNS) / range;
  return progress * SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY;
}

/**
 * Update the sustained-negative-production counter for a sector. Increments by
 * 1 if the current policy level is negative; decrements by 1 (floored at 0)
 * otherwise. So a corp that briefly dipped to -25 for 30 turns then recovered
 * needs another 30 turns at neutral-or-positive to fully clear the counter,
 * preventing oscillation exploits.
 */
export function nextNegativeProductionCounter(
  prevCounter: number | null | undefined,
  currentPolicyLevel: number
): number {
  const prev = prevCounter ?? 0;
  if (currentPolicyLevel < 0) return prev + 1;
  return Math.max(0, prev - 1);
}

/**
 * Compute daily growth cost from per-turn growth basis and country prime rate.
 *
 * The base growth cost is:
 *   revenue × (perTurnGrowthRate / 100) × GROWTH_COST_MULTIPLIER × TURNS_PER_DAY
 *
 * `perTurnGrowthRate` is growthRate ÷ GROWTH_RATE_TURNS_PER_YEAR (see sector turn
 * processing). The `× TURNS_PER_DAY` term converts the per-turn charge into the
 * genuine daily figure every caller divides back down by `TURNS_PER_DAY` and
 * every UI labels "/day" — so the number sits in a daily P&L alongside daily
 * revenue and maintenance without restating.
 *
 * Clock alignment (#3934): this term used to be `GROWTH_RATE_TURNS_PER_YEAR`
 * (48), which billed two financial days of cost for every one game year of
 * growth. A sector therefore paid 6× the revenue it added. Growth accrues on the
 * 48-turn year (`sectorTurn.ts`) while cost is charged on the 24-turn day, so the
 * conversion has to use the same 24 the charge does. The effective price is now
 * GROWTH_COST_MULTIPLIER (3×), which is what the constant always claimed.
 *
 * The prime rate applies a normalized modifier so higher-rate environments are
 * moderately more expensive for growth. Using `1 + primeRate / 10` instead of
 * the raw rate prevents extreme swings: a 3.75% rate yields a 1.375x multiplier
 * rather than a 3.75x one. Floor at 0.5 so zero-rate policies still cost something.
 *
 * `marketSharePercent` (0–100) drives the dominance multiplier. Pass 0 (the
 * default) when market share is unknown / not relevant — the multiplier is then
 * 1.0× and the cost matches the legacy formula.
 */
/**
 * Business Acumen growth-cost effects. A skilled CEO (a) grows their sectors more
 * cheaply and (b) is less exposed to high interest rates. Both are neutral at the
 * stat pivot (`NEUTRAL_STAT`), so callers that don't pass an acumen value behave
 * exactly as before.
 */
/** Per-point slope of the flat growth-cost discount (±~13.5% across the 1–10 band). */
export const ACUMEN_GROWTH_COST_SLOPE = 0.03;
/** Per-point slope of prime-rate exposure (±~27% across the 1–10 band). */
export const ACUMEN_RATE_SENSITIVITY_SLOPE = 0.06;

/** Higher Business Acumen → cheaper growth. Clamped to stay gentle. */
export function acumenGrowthCostMultiplier(acumen: number): number {
  return Math.max(0.5, 1 - (acumen - NEUTRAL_STAT) * ACUMEN_GROWTH_COST_SLOPE);
}

/** Higher Business Acumen → feels less of the prime-rate growth penalty. */
export function acumenRateSensitivity(acumen: number): number {
  return Math.max(0, 1 - (acumen - NEUTRAL_STAT) * ACUMEN_RATE_SENSITIVITY_SLOPE);
}

export function calculateDailyGrowthCost(
  revenue: number,
  perTurnGrowthRate: number,
  primeRate: number,
  marketSharePercent: number = 0,
  acumen: number = NEUTRAL_STAT
): number {
  // A high-Acumen CEO is less exposed to the prime-rate penalty (the rate term is
  // dampened) and pays a flat discount on top — modelling sharper capital
  // management. Neutral acumen reproduces the legacy `1 + primeRate / 10` curve.
  const rateMultiplier = Math.max(0.5, 1 + (primeRate / 10) * acumenRateSensitivity(acumen));
  const dominanceMult = getDominanceGrowthCostMultiplier(marketSharePercent);
  return (
    revenue *
    (perTurnGrowthRate / 100) *
    GROWTH_COST_MULTIPLIER *
    TURNS_PER_DAY *
    rateMultiplier *
    dominanceMult *
    acumenGrowthCostMultiplier(acumen)
  );
}

/** Maximum growth rate a player can set (% per game year) */
export const MAX_GROWTH_RATE = 15.0;

/** Minimum growth rate — negative means deliberate downsizing (% per game year) */
export const MIN_GROWTH_RATE = -2;

/**
 * Per-turn convergence step when ticking `currentGrowthRate` toward
 * `targetGrowthRate`. Matches the ~0.5%/turn design note so a full hand-off
 * from any slider position to the opposite bound (≈17pp range) completes in
 * ~34 turns — under one game year. Players see immediate direction change but
 * can't swing revenue instantaneously.
 */
export const GROWTH_TREND_STEP_PER_TURN = 0.5;

/**
 * Each state's total sector market size = stateGDP (in millions) × this fraction / sector count.
 * GDP is stored as millions (e.g. CA = 3,598,500 meaning $3.6T).
 * With fraction = 100: CA each sector ≈ $27.7M, Wyoming ≈ $311K, London ≈ $3.9M.
 */
export const SECTOR_MARKET_GDP_FRACTION = 100;

/**
 * Scale factor applied only during seed generation (seedUnownedSectors).
 * Does not affect live game calculations. At equal weight (1/17 ≈ 5.88%),
 * produces exactly 4.5× the old SECTOR_MARKET_GDP_FRACTION / 17 baseline.
 */
export const SECTOR_SEED_SCALE = 450;

/**
 * Cost to split unowned market = unownedRevenue × this fraction.
 * E.g. 5% of a $1M unowned sector = $50K per split.
 */
export const SPLIT_COST_FRACTION = 0.05;

/**
 * Base fraction of unowned market captured per split (before MS bonus).
 * E.g. 5% of unowned sector captured at 0 MS.
 */
export const SPLIT_BASE_CAPTURE_FRACTION = 0.05;

/**
 * Bonus multiplier when splitting unowned (target has 0 MS).
 * Unowned sectors have no defense, so capture is more favorable.
 */
export const UNOWNED_CAPTURE_BONUS_MULTIPLIER = 1.25;

/** Divisor for marketing strength in capture formula */
export const MS_CAPTURE_DIVISOR = 100;

/**
 * Attack owned sector: cash cost = target revenue × this fraction.
 * E.g. 10% of a $1M sector = $100K to attack.
 */
export const ATTACK_OWNED_COST_FRACTION = 0.1;

/**
 * Fraction of target sector revenue contested in an attack.
 * Attacker's share = attackerMS / (attackerMS + defenderMS).
 * E.g. 10% contested, you have 100 MS vs 50 MS → you capture 100/150 × 10% = 6.67% of their revenue.
 */
export const ATTACK_OWNED_CONTESTED_FRACTION = 0.1;

/** Number of sector types (for market size division) */
export const SECTOR_TYPE_COUNT = CORPORATION_TYPES.length;

/**
 * Cost to expand growth by 1% = sector revenue × this multiplier.
 * E.g. a $1M revenue sector costs $50K to expand by 1%.
 * Downsizing returns the same amount.
 */
export const GROWTH_ADJUST_COST_PER_PERCENT = 0.05;

/**
 * Turns over which a sector growth rate is applied (compounding).
 *
 * One game year = 48 turns, so each turn applies 1/48th of the rate. This is
 * NOT a day: {@link TURNS_PER_DAY} is 24, and every money figure in the game
 * (revenue, maintenance, wages, growth cost, profit) is a *daily* rate on that
 * 24-turn clock. A game year is therefore two financial days.
 *
 * Was named `GROWTH_RATE_TURNS_PER_DAY`, which read as "48 turns per day" and
 * made the growth rate look like a daily figure in every call site and label
 * that touched it. Renamed in #3934 alongside the UI copy.
 */
export const GROWTH_RATE_TURNS_PER_YEAR = 48;

/** Turns per day — daily rates are divided by this for per-turn processing */
export const TURNS_PER_DAY = 24;

// ─── Share trading constants ──────────────────────────────────────────────────

/**
 * Maximum percentage of current outstanding shares a CEO can issue publicly in one action (50%).
 */
export const MAX_PUBLIC_ISSUANCE_PERCENT = 50;

/**
 * Premium above current market price charged for CEO self-issuance (15%).
 * Money goes directly to corporate liquid capital.
 */
export const CEO_SELF_ISSUANCE_PREMIUM = 0.15;

/** Re-export hostile takeover / subsidiary thresholds for API and UI (single source). */
export {
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
  HOSTILE_TAKEOVER_PREMIUM_RATE,
  SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT,
} from "@/lib/corporations/corporateOwnership";

/**
 * Maximum percentage of current outstanding shares a CEO can self-issue in one action (20%).
 * Lower than public issuance (50%) since self-issuance is more dilutive to other holders.
 */
export const MAX_SELF_ISSUANCE_PERCENT = 20;

// ─── Share pricing constants ──────────────────────────────────────────────────

/**
 * Annual discount rate for NPV (perpetuity) calculation.
 * Higher = less aggressive valuation.
 * 15% reflects infrastructure/industrial perpetuity discount rates.
 */
export const NPV_ANNUAL_DISCOUNT_RATE = 0.15;

/**
 * Fraction of a sector's NPV used as the asking price when a CEO lists it
 * for sale. Sellers accept a 25% discount on fair value to attract buyers
 * (and avoid having to operate a sector outside their specialization).
 */
export const SECTOR_FOR_SALE_PRICE_FRACTION = 0.75;

/**
 * P/E multiple used to convert annual income to share price.
 * incomePrice = (annualIncome / totalShares) × this
 */
export const SHARE_PRICE_PE_MULTIPLE = 6;

/**
 * Maximum ratio of income-based price to balance-sheet price.
 * Prevents runaway valuations for hyper-profitable corps.
 */
export const INCOME_PRICE_CAP_MULTIPLE = 4;

/**
 * Minimum share price ($). Prevents zero or negative prices.
 */
export const MIN_SHARE_PRICE = 0.01;

// ─── New fundamental formula weights ──────────────────────────────────────
/** Weight for tangible-book-per-share in the fundamental value formula. */
export const FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT = 1.0;
/** Weight for earnings-power-per-share in the fundamental value formula. */
export const FUNDAMENTAL_EARNINGS_POWER_WEIGHT = 0.4;
/** Weight for growth-premium-per-share in the fundamental value formula. */
export const FUNDAMENTAL_GROWTH_PREMIUM_WEIGHT = 0.1;

/** Number of political turns used to compute the rolling-average earnings. */
export const FUNDAMENTAL_ROLLING_AVG_TURNS = 3;

// ─── Bond-income interest-rate-risk valuation adjustments ─────────────────
/**
 * Multiplier applied to the bond-coupon-derived slice of normalized earnings
 * before it is capitalized into share price. A business that funds its
 * earnings with bond coupons carries interest-rate risk the operating
 * business does not, so the market should pay less per ₳ of coupon income
 * than per ₳ of operating profit. Also applied to bond holdings in the
 * tangible-book floor (mark-to-market / rate risk on the principal).
 */
export const BOND_INCOME_SHARE_PRICE_DISCOUNT = 0.75;

/**
 * Reliance threshold (fraction of normalized net income coming from bond
 * coupons) above which an additional graduated valuation penalty applies to
 * the earnings-derived components. Below this, no extra penalty.
 */
export const BOND_INCOME_RELIANCE_THRESHOLD = 0.75;

/**
 * Floor multiplier applied to the earnings-power + growth-premium components
 * when bond reliance reaches 100%. The penalty ramps linearly from 1.0x at
 * {@link BOND_INCOME_RELIANCE_THRESHOLD} down to this value at full reliance —
 * no cliff at the threshold, so the boundary cannot be gamed.
 */
export const BOND_INCOME_MAX_RELIANCE_PENALTY = 0.5;

/**
 * g is capped at (costOfCapital − this value) to prevent division-by-zero in
 * the Gordon Growth Model terminal-value formula.
 */
export const GROWTH_PREMIUM_CAP_BUFFER = 0.02;

/**
 * Additional risk premium added to the prime rate to produce costOfCapital,
 * keyed by CorporationType. Higher-volatility sectors demand a higher premium.
 */
export const SECTOR_RISK_PREMIUM: Record<string, number> = {
  financial: 0.07,
  media: 0.05,
  manufacturing: 0.04,
  chemical_industries: 0.05,
  healthcare: 0.05,
  retail: 0.04,
  automobiles: 0.05,
  technology: 0.06,
  energy: 0.07,
  agriculture: 0.03,
  real_estate: 0.04,
  construction: 0.04,
  defense: 0.04,
  telecommunications: 0.04,
  entertainment: 0.06,
  logistics: 0.04,
  extraction: 0.07,
  default: 0.05,
};

/**
 * Maximum dividend rate (%). CEOs cannot set above this; turn processing clamps existing values.
 */
export const MAX_DIVIDEND_RATE = 25;

// ─── Sector affinity sets ────────────────────────────────────────────────────
// Each sector-specific metric only affects the listed sector types.

/** Sectors affected by workforce skill (education → skilled labor availability) */
export const WORKFORCE_SKILL_SECTORS = new Set<CorporationType>([
  "technology",
  "chemical_industries",
  "healthcare",
  "manufacturing",
  "defense",
]);

/** Sectors affected by crime rate (foot traffic, theft, vandalism risk) */
export const CRIME_RATE_SECTORS = new Set<CorporationType>([
  "retail",
  "real_estate",
  "entertainment",
]);

/** Sectors affected by broadband access (connectivity-dependent operations) */
export const BROADBAND_SECTORS = new Set<CorporationType>([
  "technology",
  "telecommunications",
  "media",
  "financial",
]);

/** Sectors affected by road condition (logistics and supply chain) */
export const ROAD_CONDITION_SECTORS = new Set<CorporationType>([
  "manufacturing",
  "retail",
  "agriculture",
  "automobiles",
  "construction",
  "logistics",
  "extraction",
]);

/** Sectors affected by carbon emissions (regulatory / compliance costs) */
export const CARBON_EMISSIONS_SECTORS = new Set<CorporationType>([
  "energy",
  "chemical_industries",
  "manufacturing",
  "automobiles",
  "extraction",
]);

/** Sectors affected by cost of living (labor cost proxy) */
export const COST_OF_LIVING_SECTORS = new Set<CorporationType>([
  "chemical_industries",
  "manufacturing",
  "retail",
  "agriculture",
  "construction",
  "logistics",
  "extraction",
]);

// ─── Unemployment → Profit Margin modifier ─────────────────────────────────

/** Unemployment pivot point — below this reduces margins, above increases them */
export const UNEMPLOYMENT_PIVOT = 3;
/** Max profit margin modifier (±%) from unemployment */
export const UNEMPLOYMENT_MAX_MODIFIER = 5;
/** Unemployment rate at which the max positive modifier is reached */
export const UNEMPLOYMENT_HIGH = 10;

/**
 * Compute profit margin modifier from state unemployment rate.
 * - Below 3%: linear scale to -5% (tight labor → higher wages → lower margins)
 * - Above 3%: linear scale to +5% at 10%+ (cheap labor → higher margins)
 * - At 3%: 0% modifier
 */
export function getUnemploymentMarginModifier(unemploymentRate: number | null | undefined): number {
  if (unemploymentRate == null) return 0;
  if (unemploymentRate <= UNEMPLOYMENT_PIVOT) {
    return (
      ((unemploymentRate - UNEMPLOYMENT_PIVOT) / UNEMPLOYMENT_PIVOT) * UNEMPLOYMENT_MAX_MODIFIER
    );
  }
  const range = UNEMPLOYMENT_HIGH - UNEMPLOYMENT_PIVOT;
  const ratio = Math.min((unemploymentRate - UNEMPLOYMENT_PIVOT) / range, 1);
  return ratio * UNEMPLOYMENT_MAX_MODIFIER;
}

// ─── Power Grid Reliability → Profit Margin modifier ────────────────────────

/** Grid reliability gate — above this threshold, no effect */
export const GRID_RELIABILITY_GATE = 95;
/** Grid reliability floor — at or below this, max penalty applies */
export const GRID_RELIABILITY_FLOOR = 85;
/** Max margin penalty from poor grid reliability (%) */
export const GRID_RELIABILITY_MAX_PENALTY = 4;

/**
 * Compute profit margin modifier from state power grid reliability.
 * Gated effect: no impact above 95% uptime. Below 95%, linear penalty
 * scaling to -4% at 85% or lower. Affects ALL sectors — every business
 * needs electricity.
 *
 * - Above 95%: 0% modifier (grid is reliable enough)
 * - 85–95%: linear scale from 0% to -4%
 * - Below 85%: capped at -4%
 */
export function getGridReliabilityMarginModifier(reliability: number | null | undefined): number {
  if (reliability == null) return 0;
  if (reliability >= GRID_RELIABILITY_GATE) return 0;
  if (reliability <= GRID_RELIABILITY_FLOOR) return -GRID_RELIABILITY_MAX_PENALTY;
  const range = GRID_RELIABILITY_GATE - GRID_RELIABILITY_FLOOR;
  const ratio = (GRID_RELIABILITY_GATE - reliability) / range;
  return -ratio * GRID_RELIABILITY_MAX_PENALTY;
}

// ─── Corruption → Profit Margin modifier ────────────────────────────────────

/** Max margin penalty from corruption (%) */
export const CORRUPTION_MAX_PENALTY = 3;
/** Corruption index value at which max penalty is reached */
export const CORRUPTION_MAX_VALUE = 100;

/**
 * Compute profit margin modifier from state corruption index.
 * Higher corruption = higher costs from bribes, unpredictable enforcement,
 * regulatory shakedowns, and contract uncertainty.
 *
 * - At 0 corruption: 0% modifier
 * - Linear scale to -3% at corruption index 100
 */
export function getCorruptionMarginModifier(corruptionIndex: number | null | undefined): number {
  if (corruptionIndex == null) return 0;
  const clamped = Math.max(0, Math.min(CORRUPTION_MAX_VALUE, corruptionIndex));
  return -(clamped / CORRUPTION_MAX_VALUE) * CORRUPTION_MAX_PENALTY;
}

// ─── Workforce Skill → Profit Margin modifier (sector-specific) ─────────────

/** Pivot for workforce skill — at this value, modifier is 0 */
export const WORKFORCE_SKILL_PIVOT = 50;
/** Max profit margin modifier (±%) from workforce skill */
export const WORKFORCE_SKILL_MAX_MODIFIER = 4;

/**
 * Compute profit margin modifier from state workforce skill.
 * Only applies to: technology, chemical_industries, healthcare, manufacturing, defense.
 *
 * - At 50: 0% modifier
 * - Below 50: linear penalty to -4% at 0 (unskilled labor → higher training/error costs)
 * - Above 50: linear bonus to +4% at 100 (skilled labor → higher productivity)
 */
export function getWorkforceSkillMarginModifier(workforceSkill: number | null | undefined): number {
  if (workforceSkill == null) return 0;
  const clamped = Math.max(0, Math.min(100, workforceSkill));
  if (clamped >= WORKFORCE_SKILL_PIVOT) {
    return (
      ((clamped - WORKFORCE_SKILL_PIVOT) / (100 - WORKFORCE_SKILL_PIVOT)) *
      WORKFORCE_SKILL_MAX_MODIFIER
    );
  }
  return ((clamped - WORKFORCE_SKILL_PIVOT) / WORKFORCE_SKILL_PIVOT) * WORKFORCE_SKILL_MAX_MODIFIER;
}

// ─── Crime Rate → Profit Margin modifier (sector-specific) ─────────────────

/**
 * Crime rate (incidents per 100k) at which no penalty applies.
 * States below this level are considered safe enough for no impact.
 */
export const CRIME_RATE_LOW = 1500;
/**
 * Crime rate (incidents per 100k) at which maximum penalty applies.
 * Calibrated to the highest realistic seed-data tier.
 */
export const CRIME_RATE_HIGH = 3500;
/** Max margin penalty (%) from crime rate */
export const CRIME_RATE_MAX_PENALTY = 5;

/**
 * Compute profit margin modifier from state crime rate (incidents per 100k).
 * Only applies to: retail, real_estate, entertainment.
 *
 * - At or below 1500 per 100k: 0% modifier
 * - Linear penalty to -5% at 3500+ per 100k (theft, vandalism, lower foot traffic)
 */
export function getCrimeRateMarginModifier(crimeRate: number | null | undefined): number {
  if (crimeRate == null) return 0;
  if (crimeRate <= CRIME_RATE_LOW) return 0;
  if (crimeRate >= CRIME_RATE_HIGH) return -CRIME_RATE_MAX_PENALTY;
  return (
    -((crimeRate - CRIME_RATE_LOW) / (CRIME_RATE_HIGH - CRIME_RATE_LOW)) * CRIME_RATE_MAX_PENALTY
  );
}

// ─── Broadband Access → Profit Margin modifier (sector-specific) ─────────────

/** Broadband gate — above this %, no penalty */
export const BROADBAND_GATE = 70;
/** Broadband floor — at or below this %, max penalty applies */
export const BROADBAND_FLOOR = 40;
/** Max margin penalty (%) from poor broadband access */
export const BROADBAND_MAX_PENALTY = 4;

/**
 * Compute profit margin modifier from state broadband access (%).
 * Only applies to: technology, telecommunications, media, financial.
 *
 * Gated effect: no impact at or above 70%. Below 70%, linear penalty
 * scaling to -4% at 40% or lower.
 *
 * - At or above 70%: 0% modifier
 * - 40–70%: linear scale from 0% to -4%
 * - Below 40%: capped at -4%
 */
export function getBroadbandMarginModifier(broadbandAccess: number | null | undefined): number {
  if (broadbandAccess == null) return 0;
  if (broadbandAccess >= BROADBAND_GATE) return 0;
  if (broadbandAccess <= BROADBAND_FLOOR) return -BROADBAND_MAX_PENALTY;
  const range = BROADBAND_GATE - BROADBAND_FLOOR;
  const ratio = (BROADBAND_GATE - broadbandAccess) / range;
  return -ratio * BROADBAND_MAX_PENALTY;
}

// ─── Road Condition → Profit Margin modifier (sector-specific) ───────────────

/** Road condition pivot — below this, penalty; above, bonus */
export const ROAD_CONDITION_PIVOT = 60;
/** Max profit margin modifier (±%) from road condition */
export const ROAD_CONDITION_MAX_MODIFIER = 3;

/**
 * Compute profit margin modifier from state road condition (0–100 index).
 * Only applies to: manufacturing, retail, agriculture, automobiles, construction.
 *
 * - At 60: 0% modifier
 * - Below 60: linear penalty to -3% at 0 (poor roads raise logistics costs)
 * - Above 60: linear bonus to +3% at 100 (good roads lower distribution costs)
 */
export function getRoadConditionMarginModifier(roadCondition: number | null | undefined): number {
  if (roadCondition == null) return 0;
  const clamped = Math.max(0, Math.min(100, roadCondition));
  if (clamped >= ROAD_CONDITION_PIVOT) {
    return (
      ((clamped - ROAD_CONDITION_PIVOT) / (100 - ROAD_CONDITION_PIVOT)) *
      ROAD_CONDITION_MAX_MODIFIER
    );
  }
  return ((clamped - ROAD_CONDITION_PIVOT) / ROAD_CONDITION_PIVOT) * ROAD_CONDITION_MAX_MODIFIER;
}

// ─── Carbon Emissions → Profit Margin modifier (sector-specific) ─────────────

/** Carbon emissions (metric tons per capita) at or below which no penalty applies */
export const CARBON_EMISSIONS_LOW = 3;
/** Carbon emissions (metric tons per capita) at or above which max penalty applies */
export const CARBON_EMISSIONS_HIGH = 25;
/** Max margin penalty (%) from carbon emissions */
export const CARBON_EMISSIONS_MAX_PENALTY = 3;

/**
 * Compute profit margin modifier from state carbon emissions (MT per capita).
 * Only applies to: energy, manufacturing, automobiles.
 *
 * Higher emissions = higher regulatory & compliance costs.
 * - At or below 3 MT: 0% modifier
 * - Linear penalty to -3% at 25+ MT (regulatory burden, carbon taxes)
 */
export function getCarbonEmissionsMarginModifier(
  carbonEmissions: number | null | undefined
): number {
  if (carbonEmissions == null) return 0;
  if (carbonEmissions <= CARBON_EMISSIONS_LOW) return 0;
  if (carbonEmissions >= CARBON_EMISSIONS_HIGH) return -CARBON_EMISSIONS_MAX_PENALTY;
  return (
    -((carbonEmissions - CARBON_EMISSIONS_LOW) / (CARBON_EMISSIONS_HIGH - CARBON_EMISSIONS_LOW)) *
    CARBON_EMISSIONS_MAX_PENALTY
  );
}

// ─── Cost of Living → Profit Margin modifier (sector-specific) ───────────────

/** Cost of living pivot — national average; above this hurts margins */
export const COST_OF_LIVING_PIVOT = 100;
/** Points above/below pivot for max modifier (±3%) */
export const COST_OF_LIVING_RANGE = 30;
/** Max profit margin modifier (±%) from cost of living */
export const COST_OF_LIVING_MAX_MODIFIER = 3;

/**
 * Compute profit margin modifier from state cost of living index (100 = national avg).
 * Only applies to: manufacturing, retail, agriculture.
 *
 * Higher cost of living raises labor costs for physical-presence businesses.
 * - At 100 (national avg): 0% modifier
 * - Below 100: linear bonus to +3% at 70 or lower (cheap labor → higher margins)
 * - Above 100: linear penalty to -3% at 130 or higher (expensive labor → lower margins)
 */
export function getCostOfLivingMarginModifier(costOfLiving: number | null | undefined): number {
  if (costOfLiving == null) return 0;
  const mod =
    ((COST_OF_LIVING_PIVOT - costOfLiving) / COST_OF_LIVING_RANGE) * COST_OF_LIVING_MAX_MODIFIER;
  return Math.max(-COST_OF_LIVING_MAX_MODIFIER, Math.min(COST_OF_LIVING_MAX_MODIFIER, mod));
}

/**
 * Expropriation-risk margin drag from low investor confidence (spec §12.4 feed 1).
 * 0 at/above baseline; scales linearly to EXPROPRIATION_RISK_MARGIN_MAX at
 * confidence 0. Applied to PRIVATE corps only — the caller gates on isStateOwned.
 */
export function getExpropriationRiskMarginModifier(
  investorConfidence: number | null | undefined
): number {
  if (investorConfidence == null || !Number.isFinite(investorConfidence)) return 0;
  if (investorConfidence >= INVESTOR_CONFIDENCE_BASELINE) return 0;
  const below = INVESTOR_CONFIDENCE_BASELINE - Math.max(0, investorConfidence);
  const frac = below / INVESTOR_CONFIDENCE_BASELINE; // 0..1
  return EXPROPRIATION_RISK_MARGIN_MAX * frac;
}

/**
 * Profit margin bonus for home state/nation. International sectors get 0.
 * - Home state (sector in HQ state): +10%
 * - Home nation (same country, different state): +5%
 * - International (different country): 0%
 */
export function getHomeLocationMarginBonus(
  sectorStateId: string,
  headquartersState: string,
  sectorCountryId: string,
  hqCountryId: string
): number {
  if (sectorStateId === headquartersState) return HOME_STATE_MARGIN_BONUS;
  if (sectorCountryId === hqCountryId) return HOME_NATION_MARGIN_BONUS;
  return 0;
}

export interface StateSectorSpecialization {
  primary: CorporationType;
  secondary: CorporationType;
}

/**
 * Profit margin bonus for state/region sector specializations.
 * - Primary sector: +10 percentage points
 * - Secondary sector: +5 percentage points
 */
export function getStateSectorSpecializationMarginBonus(
  specialization: StateSectorSpecialization | null | undefined,
  sectorType: CorporationType
): number {
  if (!specialization) return 0;
  if (specialization.primary === sectorType) return STATE_PRIMARY_SECTOR_MARGIN_BONUS;
  if (specialization.secondary === sectorType) return STATE_SECONDARY_SECTOR_MARGIN_BONUS;
  return 0;
}

// ─── Inflation → Profit Margin modifier (national-level) ─────────────────────

/** Inflation target — at this rate, no modifier */
export const INFLATION_TARGET = 2.0;
/** Max margin bonus from low inflation (%) — at 0% inflation */
export const INFLATION_LOW_MAX_BONUS = 2;
/** Max margin penalty from high inflation (%) — at 10%+ inflation */
export const INFLATION_HIGH_MAX_PENALTY = 8;
/** Inflation rate at which max penalty is reached */
export const INFLATION_HIGH_THRESHOLD = 10;
/** Penalty coefficient for deflation (pp per pp below 0%) — ~2× the inflation penalty rate.
 *  Bounded in practice by the MIN_INFLATION=-2.0 floor (inflation.ts): max deflation
 *  margin penalty = 2 * 2 = -4pp. Raised to 4 alongside removing the floor in commit
 *  05f59109c, which together produced the t1166 unbounded deflation-spiral incident. */
export const DEFLATION_PENALTY_COEFF = 2;

/**
 * Compute profit margin modifier from national inflation rate.
 * Applied at the country level (all sectors in that country).
 *
 * - Below 0% (deflation): penalty at 2× the per-pp rate of the inflation penalty
 * - 0% to 2% (below target): linear bonus to +2% at 0% (low prices = margin-friendly)
 * - Above 2%: linear penalty to -8% at 10%+ (rising input costs squeeze margins)
 * - At 2%: 0% modifier
 */
export function getInflationMarginModifier(inflationRate: number | null | undefined): number {
  if (inflationRate == null) return 0;
  if (inflationRate < 0) {
    // Deflation: each pp below 0% applies a penalty at 2× the inflation penalty rate
    return inflationRate * DEFLATION_PENALTY_COEFF;
  }
  if (inflationRate <= INFLATION_TARGET) {
    // Below target but non-negative: linear bonus from 0 at target to +BONUS at 0%
    return ((INFLATION_TARGET - inflationRate) / INFLATION_TARGET) * INFLATION_LOW_MAX_BONUS;
  }
  // Above target: penalty scales linearly to max at threshold
  const excess = inflationRate - INFLATION_TARGET;
  const range = INFLATION_HIGH_THRESHOLD - INFLATION_TARGET;
  const ratio = Math.min(excess / range, 1);
  return -ratio * INFLATION_HIGH_MAX_PENALTY;
}

// ─── Debt-to-GDP → Profit Margin modifier (national-level) ──────────────────

/** Maximum penalty from debt-to-GDP margin modifier (percentage points) */
/**
 * Floor for the sovereign debt-to-GDP margin penalty.
 *
 * Loosened from -15 to -5. This modifier is a genuine FEEDBACK LOOP — corporate
 * margins fall, so corporate tax falls, so the deficit widens, so debt rises,
 * so the penalty deepens — and on the 1000-turn run it hit the old floor around
 * turn 200 and never left, with China reaching a debt ratio of 45x GDP. At -15
 * it was charging every firm a permanent 15pp of margin for a sovereign-side
 * problem they cannot influence, which is a large share of why 89% of firms
 * ended loss-making. -5 keeps the signal (indebted states are worse places to
 * operate) without making it the dominant term in every firm's P&L.
 */
export const DEBT_TO_GDP_MAX_PENALTY = -5;

/**
 * Compute profit margin modifier from national debt-to-GDP ratio.
 * Applied at the country level (all sectors in that country).
 *
 * - Below 50%: no effect
 * - 50–100%: -0.5% penalty per 10% of debt-to-GDP (e.g. 80% → -1.5%)
 * - Above 100%: -2.5% (for 50-100 range) plus -1% per 10% over 100%
 *   (e.g. 130% → -2.5% - 3% = -5.5%)
 * - Capped at -15% to prevent runaway penalties at extreme debt levels
 */
export function getDebtToGdpMarginModifier(debtToGdpRatio: number | null | undefined): number {
  if (debtToGdpRatio == null) return 0;
  const pct = debtToGdpRatio * 100; // Convert ratio to percentage
  if (pct <= 50) return 0;
  if (pct <= 100) {
    // -0.5% per 10% of debt-to-GDP in the 50-100 range
    return -((pct - 50) / 10) * 0.5;
  }
  // Base penalty for 50-100% range: -2.5%
  const basePenalty = -2.5;
  // Additional: -1% per 10% over 100%
  const overPenalty = -((pct - 100) / 10) * 1.0;
  return Math.max(DEBT_TO_GDP_MAX_PENALTY, basePenalty + overPenalty);
}

// ─── Deficit-to-GDP → Profit Margin modifier (national-level) ────────────────

/**
 * Compute profit margin modifier from national deficit as % of GDP.
 * Applied at the country level (all sectors in that country).
 * Deficit spending is stimulative — a POSITIVE modifier to profit margins.
 *
 * Takes surplus-to-GDP ratio (negative = deficit).
 * - Surplus (positive): 0% modifier (fiscal tightening doesn't penalize here)
 * - Deficit: +0.5% per 1% of GDP deficit (e.g. -3% deficit → +1.5% bonus)
 *   Capped at +5% bonus (10% deficit)
 */
export const DEFICIT_MARGIN_BONUS_PER_PERCENT = 0.5;
export const DEFICIT_MARGIN_MAX_BONUS = 5;

export function getDeficitToGdpMarginModifier(
  surplusToGdpRatio: number | null | undefined
): number {
  if (surplusToGdpRatio == null) return 0;
  // surplusToGdpRatio is negative when there's a deficit
  if (surplusToGdpRatio >= 0) return 0;
  const deficitPct = -surplusToGdpRatio * 100; // positive number representing deficit %
  return Math.min(deficitPct * DEFICIT_MARGIN_BONUS_PER_PERCENT, DEFICIT_MARGIN_MAX_BONUS);
}

/* ─── Shared margin modifier result type ──────────────────────────────────── */

/** Sector type matches corp type: +5% bonus. Mismatch: -15% penalty. */
export const SECTOR_TYPE_MATCH_BONUS = 5;
/** Half bonus when sector matches secondary type instead of primary */
export const SECTOR_TYPE_SECONDARY_MATCH_BONUS = 2.5;
export const SECTOR_TYPE_MISMATCH_PENALTY = -15;

// ─── Corporation Type Switching ─────────────────────────────────────────────

/** Margin penalty (percentage points) applied to ALL sectors for 24 turns after switching primary/secondary type */
export const TYPE_SWITCH_MARGIN_PENALTY = -10;

/** Duration in turns (hours) that the type switch margin penalty lasts */
export const TYPE_SWITCH_PENALTY_TURNS = 24;

/** Cooldown in turns (hours) before the corp can switch type again */
export const TYPE_SWITCH_COOLDOWN_TURNS = 48;

/** -0.5% for every 2 sectors over 15 (logistical sprawl) */
export const SPRAWL_SECTOR_THRESHOLD = 15;
export const SPRAWL_PENALTY_PER_PAIR = -0.5;

// ─── Logistics Spending ─────────────────────────────────────────────────────

/**
 * Logistics strength decay rate per turn (5%).
 * At LS=100 with no spending, loses 5 points/turn. Drops to half in ~14 turns.
 * This forces constant heavy investment to maintain high logistics strength.
 */
export const LOGISTICS_DECAY_RATE = 0.05;

/**
 * Logarithmic scaling coefficient for logistics budget → strength growth.
 * growth = SCALE × ln(1 + budget / DENOM)
 */
export const LOGISTICS_GROWTH_SCALE = 2.0;

/** Budget denominator for logistics growth scaling ($500k) */
export const LOGISTICS_BUDGET_DENOM = 500_000;

/**
 * Reference logistics strength used as the denominator for the sprawl
 * benefit curve. Threshold growth is unbounded; penalty reduction is
 * clamped to a 50% floor so very high scores cannot invert the penalty.
 */
export const LOGISTICS_MAX_SPRAWL_EFFECT = 200;

/**
 * Calculate logistics strength growth per turn.
 * Unlike marketing, logistics has no diminishing returns from stored strength —
 * the 5% per-turn decay naturally limits accumulation.
 *
 * Equilibrium strengths at various budgets:
 *   $1M/day  → LS ~55   (modest sprawl reduction)
 *   $5M/day  → LS ~96   (significant)
 *   $10M/day → LS ~122  (strong)
 *   $50M/day → LS ~185  (near-maximum)
 *   $100M/day → LS ~212 (capped at 200 for sprawl effect)
 */
export function calcLogisticsGrowth(dailyBudget: number): number {
  if (dailyBudget <= 0) return 0;
  return LOGISTICS_GROWTH_SCALE * Math.log(1 + dailyBudget / LOGISTICS_BUDGET_DENOM);
}

/**
 * Apply logistics decay and growth for one turn.
 * newStrength = (1 - DECAY_RATE) × oldStrength + growth(budget)
 */
export function calcLogisticsStrengthAfterTurn(
  currentStrength: number,
  dailyBudget: number
): number {
  const afterDecay = currentStrength * (1 - LOGISTICS_DECAY_RATE);
  const growth = calcLogisticsGrowth(dailyBudget);
  return Math.max(0, afterDecay + growth);
}

// ─── R&D Score ──────────────────────────────────────────────────────────────

/** Base R&D score gain per turn when any R&D budget is set */
export const RD_BASE_GAIN_PER_TURN = 1.0;

/** Scaling coefficient for log-based R&D budget scaling (matches marketing) */
export const RD_BUDGET_SCALE = 0.65;

/** R&D score threshold where diminishing returns double (matches marketing) */
export const RD_DIMINISHING_THRESHOLD = 100;

/**
 * R&D score decay rate per turn (3%).
 * Slower than logistics (5%) — accumulated R&D knowledge degrades more slowly
 * than physical logistics infrastructure. At 3% decay with no spending,
 * score halves in ~23 turns (roughly 2 game weeks).
 */
export const RD_DECAY_RATE = 0.03;

/**
 * Calculate R&D score growth per turn.
 * Mirrors the marketing formula: base gain + log-scaled budget, with
 * diminishing returns on stored score.
 *   $100k → ~1.5/turn, $2M → ~3/turn, $10M → ~4/turn
 * At score 100+ the effective growth more than halves.
 */
export function calcRdGrowth(dailyBudget: number, currentScore: number): number {
  if (dailyBudget <= 0) return 0;
  const base = RD_BASE_GAIN_PER_TURN;
  const scaled = RD_BUDGET_SCALE * Math.log(1 + dailyBudget / 100_000);
  const raw = base + scaled;
  const excess = Math.max(0, currentScore - RD_DIMINISHING_THRESHOLD);
  const diminishing = RD_DIMINISHING_THRESHOLD / (RD_DIMINISHING_THRESHOLD + currentScore + excess);
  return raw * diminishing;
}

/**
 * Apply R&D decay and growth for one turn.
 * newScore = max(0, (1 - DECAY_RATE) × oldScore + growth(budget))
 */
export function calcRdScoreAfterTurn(currentScore: number, dailyBudget: number): number {
  const afterDecay = currentScore * (1 - RD_DECAY_RATE);
  const growth = calcRdGrowth(dailyBudget, currentScore);
  return Math.max(0, afterDecay + growth);
}

/** Max R&D-efficiency swing from worker morale (±15% at the wage-level extremes). */
export const RD_MORALE_MAX_SWING = 0.15;
/** How strongly a wage-level point above/below baseline moves R&D efficiency. */
export const RD_MORALE_SENSITIVITY = 0.5;

/**
 * Worker-morale multiplier on R&D efficiency (#84 — happy workers get more done).
 * Driven by the corp's revenue-weighted average sector `wageLevel`: 1.0 (baseline
 * pay) is neutral, paying above baseline lifts R&D output up to +{@link
 * RD_MORALE_MAX_SWING}, paying below drags it down by the same. Clamped to the
 * band. When the labour system is off, `wageLevel` defaults to 1, so this is a
 * no-op (factor 1.0) and changes nothing.
 */
export function rdMoraleFactor(avgWageLevel: number): number {
  const raw = 1 + RD_MORALE_SENSITIVITY * (avgWageLevel - 1);
  return Math.min(1 + RD_MORALE_MAX_SWING, Math.max(1 - RD_MORALE_MAX_SWING, raw));
}

// ─── R&D Innovation ─────────────────────────────────────────────────────────

/** Turns between innovation checks (every 6 turns = every 6 real hours) */
export const RD_INNOVATION_INTERVAL = 6;

/** R&D score at which innovation probability reaches 100% */
export const RD_INNOVATION_SCORE_THRESHOLD = 200;

/** Minimum revenue boost for extraction corp innovation (1%) */
export const RD_EXTRACTION_BOOST_MIN = 0.01;

/** Maximum revenue boost for extraction corp innovation (10%) */
export const RD_EXTRACTION_BOOST_MAX = 0.1;

/**
 * Minimum revenue boost for regular corp innovation (2%).
 * Mirrors the extraction floor so that any breakthrough — even at low
 * rdScore — produces a visible effect alongside the notification.
 */
export const RD_REGULAR_BOOST_MIN = 0.02;

/** Maximum revenue boost for regular corp innovation (10%). */
export const RD_REGULAR_BOOST_MAX = 0.1;

/** Minimum per-resource capacity boost for extraction innovations (1% of current capacity) */
export const RD_CAPACITY_BOOST_MIN_PCT = 0.01;

/** Maximum per-resource capacity boost for extraction innovations (15% of current capacity) */
export const RD_CAPACITY_BOOST_MAX_PCT = 0.15;

/**
 * Sector type match/mismatch modifier.
 * +5% if sector type matches the parent corporation's primary type.
 * +2.5% if sector type matches the secondary type.
 * -15% if neither matches.
 */
export function getSectorTypeMatchModifier(
  sectorType: CorporationType,
  corporationType: CorporationType,
  secondaryType?: CorporationType | null
): number {
  if (sectorType === corporationType) return SECTOR_TYPE_MATCH_BONUS;
  if (secondaryType && sectorType === secondaryType) return SECTOR_TYPE_SECONDARY_MATCH_BONUS;
  return SECTOR_TYPE_MISMATCH_PENALTY;
}

/**
 * Logistical sprawl penalty: -0.5% for every 2 sectors over 15.
 * A corporation with 15 or fewer sectors has no penalty.
 * 16-17 sectors: -0.5%, 18-19: -1.0%, etc.
 *
 * Having a secondary type doubles the base penalty (-1.0% per pair),
 * representing the complexity of managing diverse operations.
 * Logistics spending can still reduce this:
 * - At LS 0: threshold 15, penalty -0.5% per pair (or -1.0% with secondary)
 * - At LS 200 (max): threshold 30 (doubled), penalty halved
 * - Linear interpolation between 0 and 200
 */
export function getSprawlModifier(
  totalSectors: number,
  logisticsStrength?: number,
  hasSecondaryType?: boolean
): number {
  const lsFraction = Math.max(0, logisticsStrength ?? 0) / LOGISTICS_MAX_SPRAWL_EFFECT;

  // Base penalty is doubled when secondary type is active
  const basePenalty = hasSecondaryType ? SPRAWL_PENALTY_PER_PAIR * 2 : SPRAWL_PENALTY_PER_PAIR;

  // Threshold scales linearly with logistics — no upper bound
  const effectiveThreshold = SPRAWL_SECTOR_THRESHOLD + SPRAWL_SECTOR_THRESHOLD * lsFraction;
  // Penalty reduction is clamped at 50% so high scores cannot invert the penalty
  const effectivePenalty = basePenalty * Math.max(0.5, 1 - 0.5 * lsFraction);

  if (totalSectors <= effectiveThreshold) return 0;
  const excess = totalSectors - effectiveThreshold;
  return Math.floor(excess / 2) * effectivePenalty;
}

export interface MarginModifiers {
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
  /** Home state +10%, home nation +5%, international 0% */
  homeLocationModifier: number;
  /** State/region primary +10%, secondary +5% sector specialization bonus */
  stateSectorSpecializationModifier: number;
  /** +5% match, -15% mismatch between sector and corp type */
  sectorTypeMatchModifier: number;
  /** -0.5% per 2 sectors over 15 */
  sprawlModifier: number;
  /** National inflation rate impact on margins */
  inflationModifier: number;
  /** National debt-to-GDP ratio impact on margins */
  debtToGdpModifier: number;
  /** National deficit-to-GDP stimulative bonus */
  deficitToGdpModifier: number;
  /** -10% penalty for 24h after switching primary/secondary corp type */
  typeSwitchModifier: number;
  /** -5% penalty while an operating strategy transition is in progress */
  strategyTransitionModifier: number;
  /** Tariff penalty for foreign corps: -(effectiveTariffRate). 0 for domestic corps. */
  foreignTariffModifier: number;
  /** Tariff cost malus for domestic corps: -(effectiveTariffRate/100)×10. 0 for foreign corps. */
  domesticTariffMalus: number;
  /** Subsidy bonus: +15pp per qualifying active subsidy (federal and state stack). */
  subsidyModifier: number;
  /** Dominance margin penalty (pp): 0 at ≤50% share, scales to -15pp at 100%. */
  dominanceMarginPenalty: number;
  /**
   * Dominance regulatory burden (% of revenue, expressed as pp-equivalent for
   * the diagnostic): 0 at ≤50% share, up to ~5pp-equivalent at 100%. Stored as
   * the percentage-point cost of the burden so it sits naturally alongside the
   * other modifiers in the UI breakdown — actual deduction happens in the
   * sector loop, not via the margin sum.
   */
  dominanceRegulatoryBurdenPp: number;
  /** Sustained-negative-production margin penalty (pp): 0 within grace, scales to -15pp. */
  sustainedNegativeProductionPenalty: number;
  /** New strategy-aware state metric total, when routed through sectorMetricMarginProfiles. */
  stateMetricsModifier?: number;
  /** Temporary audit value for the previous sparse state metric system. */
  legacyStateMetricsModifier?: number;
  /** Top-level metric contribution diagnostics for UI/audit consumers. */
  stateMetricContributions?: StateMetricMarginContribution[];
  /** Named regional conditions (Economic Boom, Recession, …) stacked margin swing. */
  regionalConditionsModifier?: number;
  /** Itemized regional condition margin contributions for drill-down display. */
  regionalConditionModifiers?: { label: string; marginEffect: number }[];
  effective: number;
}

export interface StateMetricValues {
  fullMetrics?: StateMetrics | null;
  unemploymentRate: number | null;
  gridReliability: number | null;
  corruptionIndex: number | null;
  workforceSkill: number | null;
  crimeRate: number | null;
  broadbandAccess: number | null;
  roadCondition: number | null;
  carbonEmissions: number | null;
  costOfLiving: number | null;
}

/** National-level macroeconomic values for margin modifiers */
export interface MacroEconomicValues {
  /** Annual inflation rate (%) */
  inflationRate: number | null;
  /** Debt-to-GDP ratio (0-1+ scale, e.g. 1.2 = 120%) */
  debtToGdpRatio: number | null;
  /** Surplus-to-GDP ratio (negative = deficit) */
  surplusToGdpRatio: number | null;
}

/**
 * Single source of truth for computing all margin modifiers for a sector.
 * Used by the turn processor, corporation API, and sector detail API.
 *
 * @param sectorType - The sector's corporation type
 * @param baseProfitMargin - The sector's base profit margin
 * @param metrics - Raw state metric values
 * @param commodityMod - Combined commodity modifier (input cost + surplus bonus), default 0
 * @param homeLocationBonus - From getHomeLocationMarginBonus (home state +10%, home nation +5%, international 0)
 * @returns All modifier values and the effective margin (rounded to 1 decimal)
 */
export function computeAllMarginModifiers(
  sectorType: CorporationType,
  baseProfitMargin: number,
  metrics: StateMetricValues,
  commodityMod: number = 0,
  homeLocationBonus: number = 0,
  corporationType?: CorporationType,
  totalSectors?: number,
  macroEcon?: MacroEconomicValues,
  logisticsStrength?: number,
  secondaryType?: CorporationType | null,
  typeSwitchPenaltyActive?: boolean,
  foreignTariffMod: number = 0,
  domesticTariffMod: number = 0,
  subsidyMod: number = 0,
  strategyTransitionMod: number = 0,
  stateSectorSpecializationMod: number = 0,
  marketSharePercent: number = 0,
  negativeProductionSustainedTurns: number = 0,
  currentPolicyLevel: number = 0,
  stateMetricOverride: StateMetricMarginOverride | null = null,
  /**
   * State-owned (NatCorp) sectors are exempt from the private-firm penalties for
   * market dominance, off-type sectors, and logistical sprawl — a NatCorp is a
   * diversified state holding company that holds nationalized sectors and
   * dominates by design. Its state-run inefficiency is modelled by the dedicated
   * SOE efficiency penalty, not these (Bug #0775).
   */
  stateOwned: boolean = false,
  regionalConditionsModifier: number = 0,
  regionalConditionModifiers: { label: string; marginEffect: number }[] = []
): MarginModifiers {
  const unemploymentMod = getUnemploymentMarginModifier(metrics.unemploymentRate);
  const gridMod = getGridReliabilityMarginModifier(metrics.gridReliability);
  const corruptionMod = getCorruptionMarginModifier(metrics.corruptionIndex);

  const workforceSkillApplies = WORKFORCE_SKILL_SECTORS.has(sectorType);
  const crimeRateApplies = CRIME_RATE_SECTORS.has(sectorType);
  const broadbandApplies = BROADBAND_SECTORS.has(sectorType);
  const roadConditionApplies = ROAD_CONDITION_SECTORS.has(sectorType);
  const carbonEmissionsApplies = CARBON_EMISSIONS_SECTORS.has(sectorType);
  const costOfLivingApplies = COST_OF_LIVING_SECTORS.has(sectorType);

  const workforceSkillMod = workforceSkillApplies
    ? getWorkforceSkillMarginModifier(metrics.workforceSkill)
    : 0;
  const crimeRateMod = crimeRateApplies ? getCrimeRateMarginModifier(metrics.crimeRate) : 0;
  const broadbandMod = broadbandApplies ? getBroadbandMarginModifier(metrics.broadbandAccess) : 0;
  const roadConditionMod = roadConditionApplies
    ? getRoadConditionMarginModifier(metrics.roadCondition)
    : 0;
  const carbonEmissionsMod = carbonEmissionsApplies
    ? getCarbonEmissionsMarginModifier(metrics.carbonEmissions)
    : 0;
  const costOfLivingMod = costOfLivingApplies
    ? getCostOfLivingMarginModifier(metrics.costOfLiving)
    : 0;
  const legacyStateMetricTotal =
    unemploymentMod +
    gridMod +
    corruptionMod +
    workforceSkillMod +
    crimeRateMod +
    broadbandMod +
    roadConditionMod +
    carbonEmissionsMod +
    costOfLivingMod;
  const stateMetricTotal = stateMetricOverride?.total ?? legacyStateMetricTotal;
  const headline = stateMetricOverride?.headlineModifiers;

  const sectorTypeMatchMod =
    stateOwned || !corporationType
      ? 0
      : getSectorTypeMatchModifier(sectorType, corporationType, secondaryType);
  const sprawlMod =
    stateOwned || totalSectors == null
      ? 0
      : getSprawlModifier(totalSectors, logisticsStrength, !!secondaryType);

  // National-level macroeconomic modifiers
  const inflationMod = macroEcon ? getInflationMarginModifier(macroEcon.inflationRate) : 0;
  const debtToGdpMod = macroEcon ? getDebtToGdpMarginModifier(macroEcon.debtToGdpRatio) : 0;
  const deficitToGdpMod = macroEcon
    ? getDeficitToGdpMarginModifier(macroEcon.surplusToGdpRatio)
    : 0;

  const typeSwitchMod = typeSwitchPenaltyActive ? TYPE_SWITCH_MARGIN_PENALTY : 0;
  const dominanceMarginMod = stateOwned ? 0 : getDominanceMarginPenalty(marketSharePercent);
  // Regulatory burden is deducted from revenue (not margin) by the sector loop.
  // We surface its margin-point equivalent here so the UI breakdown can show
  // the full cost of dominance in one place. NOT included in `totalMod` to
  // avoid double-counting — the sector loop subtracts the burden from revenue
  // directly, which is mathematically equivalent to a margin-pp deduction.
  const dominanceRegBurdenPp = stateOwned
    ? 0
    : -100 * getDominanceRegulatoryBurden(marketSharePercent);
  const negProductionMod = getSustainedNegativeProductionPenalty(
    negativeProductionSustainedTurns,
    currentPolicyLevel
  );

  const totalMod =
    stateMetricTotal +
    commodityMod +
    homeLocationBonus +
    stateSectorSpecializationMod +
    sectorTypeMatchMod +
    sprawlMod +
    inflationMod +
    debtToGdpMod +
    deficitToGdpMod +
    typeSwitchMod +
    foreignTariffMod +
    domesticTariffMod +
    subsidyMod +
    strategyTransitionMod +
    dominanceMarginMod +
    negProductionMod +
    regionalConditionsModifier;

  // Margin can go negative — sectors in terrible commodity markets drain cash.
  // Soft-capped on the high side to match the turn engine (softCapEffectiveMargin).
  const effective = softCapEffectiveMargin(baseProfitMargin + totalMod);

  const r = (v: number) => Math.round(v * 10) / 10;

  return {
    unemploymentModifier: r(headline?.unemploymentModifier ?? unemploymentMod),
    gridReliabilityModifier: r(headline?.gridReliabilityModifier ?? gridMod),
    corruptionModifier: r(headline?.corruptionModifier ?? corruptionMod),
    workforceSkillModifier:
      headline?.workforceSkillModifier !== undefined
        ? headline.workforceSkillModifier
        : workforceSkillApplies
          ? r(workforceSkillMod)
          : null,
    crimeRateModifier:
      headline?.crimeRateModifier !== undefined
        ? headline.crimeRateModifier
        : crimeRateApplies
          ? r(crimeRateMod)
          : null,
    broadbandModifier:
      headline?.broadbandModifier !== undefined
        ? headline.broadbandModifier
        : broadbandApplies
          ? r(broadbandMod)
          : null,
    roadConditionModifier:
      headline?.roadConditionModifier !== undefined
        ? headline.roadConditionModifier
        : roadConditionApplies
          ? r(roadConditionMod)
          : null,
    carbonEmissionsModifier:
      headline?.carbonEmissionsModifier !== undefined
        ? headline.carbonEmissionsModifier
        : carbonEmissionsApplies
          ? r(carbonEmissionsMod)
          : null,
    costOfLivingModifier:
      headline?.costOfLivingModifier !== undefined
        ? headline.costOfLivingModifier
        : costOfLivingApplies
          ? r(costOfLivingMod)
          : null,
    commodityModifier: r(commodityMod),
    homeLocationModifier: r(homeLocationBonus),
    stateSectorSpecializationModifier: r(stateSectorSpecializationMod),
    sectorTypeMatchModifier: r(sectorTypeMatchMod),
    sprawlModifier: r(sprawlMod),
    inflationModifier: r(inflationMod),
    debtToGdpModifier: r(debtToGdpMod),
    deficitToGdpModifier: r(deficitToGdpMod),
    typeSwitchModifier: r(typeSwitchMod),
    strategyTransitionModifier: r(strategyTransitionMod),
    foreignTariffModifier: r(foreignTariffMod),
    domesticTariffMalus: r(domesticTariffMod),
    subsidyModifier: r(subsidyMod),
    dominanceMarginPenalty: r(dominanceMarginMod),
    dominanceRegulatoryBurdenPp: r(dominanceRegBurdenPp),
    sustainedNegativeProductionPenalty: r(negProductionMod),
    stateMetricsModifier: r(stateMetricTotal),
    legacyStateMetricsModifier: stateMetricOverride
      ? r(stateMetricOverride.legacyTotal ?? legacyStateMetricTotal)
      : undefined,
    stateMetricContributions: stateMetricOverride?.contributions,
    regionalConditionsModifier: r(regionalConditionsModifier),
    regionalConditionModifiers: regionalConditionModifiers.map((m) => ({
      label: m.label,
      marginEffect: r(m.marginEffect),
    })),
    effective: r(effective),
  };
}

// --- Private vs Public IPO ---

/** Minimum % of total shares the founder may float to the public at IPO */
export const IPO_MIN_FLOAT_PCT = 10;

/** Maximum % of total shares the founder may float to the public at IPO (keeps founder above 50% control) */
export const IPO_MAX_FLOAT_PCT = 49;

/** Turns that must elapse between founding/last-privatization and a private→public IPO */
export const IPO_COOLDOWN_TURNS = 96;

/** Duration in turns of an open privatization buyout vote */
export const PRIVATIZATION_VOTE_DURATION_TURNS = 24;

/** Minimum % of totalShares the CEO must hold to open a privatization vote */
export const PRIVATIZATION_THRESHOLD_PCT = 75;

/** Premium over current sharePrice paid to bought-out shareholders, e.g. 0.10 = 10% */
export const PRIVATIZATION_BUYOUT_PREMIUM = 0.1;

/** Cooldown turns after a failed privatization vote before another can be opened */
export const PRIVATIZATION_FAILED_COOLDOWN_TURNS = 96;

// ─── Tech-tree asset valuation ────────────────────────────────────────────────
/**
 * Anchor-currency value per rdScore point of an unlocked tech node at full
 * (current-decade) weight. Weight decays by 50% per decade: current = 1.0,
 * previous = 0.5, two decades back = 0.25, etc.
 */
export const TECH_ASSET_VALUE_PER_RD_ANCHOR = 45_000;
