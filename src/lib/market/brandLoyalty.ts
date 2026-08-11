/**
 * Brand Loyalty — Package A core (design: ops dash /reports/brand-loyalty-plan,
 * four advisor rounds 2026-07-05/06).
 *
 * Loyalty is a REPUTATION a corp keeps, not a mode it buys. Every corp has it;
 * there is no positioning state and no conversion. It is earned by pricing
 * CONSISTENTLY against the corp's own trend and DELIVERING (selling well) — a
 * stable discounter earns it exactly like a stable premium seller. Sudden price
 * hikes above the corp's own norm are punished (the gouging penalty). It is
 * RELATIVE: one finite loyal pool per market, split by relative loyalty, so if
 * everyone maxes it nobody gains — it only pays off rivals' mistakes.
 *
 * This module is PURE (no DB, no clock). The turn layer supplies the corp's
 * revenue-weighted posture, fill, contest flag, and prior state; the clearing
 * layer calls {@link loyalSliceShares} for the demand pre-pass.
 */

// ── Tunables (defaults; see the plan's constants table for ranges) ───────────
export const LOYALTY_MAX = 100;
export const LOYALTY_MIN = 0;
/** Loyalty gained per turn when consistently priced, delivering, and contested. */
export const ACCRUAL_RATE = 1.0;
/** How far posture may drift from the corp's own norm and still count as consistent. */
export const CONSISTENCY_BAND = 0.04;
/** One-reprice upward jump vs own norm that triggers the gouging penalty. */
export const GOUGE_JUMP = 0.08;
/** One-time loyalty hit when gouging is detected (~10 turns of earned trust). */
export const DECAY_GOUGE = 10;
/** Per-turn loyalty loss for erratic pricing (drifting off your own norm). */
export const DECAY_ERRATIC = 1.0;
/** Erratic penalty is softened this much when the move is DOWNWARD (a sale, not a betrayal). */
export const DECAY_ERRATIC_DOWNWARD_FACTOR = 0.5;
/** Per-turn loyalty loss when the corp fails to sell enough of its book. */
export const DECAY_UNDERDELIVER = 1.0;
/** Fill (revenue-weighted soldFraction) below which under-delivery bites. */
export const UNDERDELIVER_FILL = 0.35;
/** Fill at or above which accrual is allowed (you actually delivered). */
export const DELIVER_FILL = 0.5;
/** Per-turn drift toward 0 when neither accruing nor penalized. */
export const DECAY_IDLE = 0.25;
/** EMA weight for the corp's own posture norm (~10-turn price-identity memory). */
export const POSTURE_NORM_ALPHA = 0.1;
/** Share of each market's demand that is "loyal-type" and split by relative loyalty. */
export const LOYAL_POOL_FRACTION = 0.4;
/** A rival must post at least this much cheaper to count as a genuine contest. */
export const CONTEST_GAP = 0.05;
/** Loyalty below this earns no protected slice (noise floor). */
export const SLICE_NOISE_FLOOR = 5;
/** Boeing rule: strength of the facility-loss loyalty hit. */
export const FACILITY_LOSS_FACTOR = 1.0;

// ── Hidden 5-label scale (players never see the number) ──────────────────────
export type LoyaltyLabel = "Unknown" | "Emerging" | "Respected" | "Trusted" | "Iconic";
/** Lower bound (inclusive) of each label band. */
export const LOYALTY_LABEL_BANDS: ReadonlyArray<readonly [number, LoyaltyLabel]> = [
  [90, "Iconic"],
  [70, "Trusted"],
  [45, "Respected"],
  [20, "Emerging"],
  [0, "Unknown"],
];

/** Map a raw loyalty value (0–100) to its player-facing label. */
export function loyaltyLabel(loyalty: number): LoyaltyLabel {
  const v = clampLoyalty(loyalty);
  for (const [floor, label] of LOYALTY_LABEL_BANDS) {
    if (v >= floor) return label;
  }
  return "Unknown";
}

/** Clamp a loyalty value into [0, 100]; non-finite → 0. */
export function clampLoyalty(loyalty: number): number {
  if (!Number.isFinite(loyalty)) return LOYALTY_MIN;
  return Math.max(LOYALTY_MIN, Math.min(LOYALTY_MAX, loyalty));
}

export interface LoyaltyUpdateInput {
  /** Prior loyalty (0–100); undefined/null treated as 0. */
  loyalty: number | null | undefined;
  /** Prior posture norm (EMA); undefined/null seeds to this turn's posture. */
  postureNorm: number | null | undefined;
  /** This turn's revenue-weighted effective posture across selling sectors. */
  posture: number;
  /** This turn's revenue-weighted soldFraction (fill). */
  fill: number;
  /** True when at least one rival in a shared market posts >= CONTEST_GAP cheaper. */
  contested: boolean;
}

export interface LoyaltyUpdateResult {
  loyalty: number;
  postureNorm: number;
  /** What happened this turn — for telemetry/UI hints, not persisted logic. */
  outcome: "gouged" | "erratic" | "underdelivered" | "accrued" | "idle-decay" | "held";
}

/**
 * Advance one corp's loyalty by a single turn. Pure.
 *
 * Order matters (plan step 1–6): gouging is judged against the PRE-jump norm,
 * so the norm EMA is updated LAST. Under-delivery stacks on top of a
 * gouge/erratic penalty. Accrual requires consistency + delivery + a genuine
 * contest (loyalty earned in a monopoly is meaningless, so it is zero there).
 */
export function updateBrandLoyalty(input: LoyaltyUpdateInput): LoyaltyUpdateResult {
  const prior = clampLoyalty(input.loyalty ?? 0);
  const posture = Number.isFinite(input.posture) ? input.posture : 0;
  const fill = Number.isFinite(input.fill) ? input.fill : 0;
  const norm =
    input.postureNorm == null || !Number.isFinite(input.postureNorm)
      ? posture // first observation: seed the norm to current posture (no first-turn gap)
      : input.postureNorm;

  const gap = posture - norm;
  const absGap = Math.abs(gap);

  let loyalty = prior;
  let penalized = false;
  let accrued = false;
  let outcome: LoyaltyUpdateResult["outcome"] = "held";

  // 1) Gouging — a sharp upward jump vs the corp's established identity.
  if (gap > GOUGE_JUMP) {
    loyalty -= DECAY_GOUGE;
    penalized = true;
    outcome = "gouged";
  } else if (absGap > CONSISTENCY_BAND) {
    // 2) Erratic — off your own norm, softer if you moved DOWN (a sale).
    loyalty -= DECAY_ERRATIC * (gap < 0 ? DECAY_ERRATIC_DOWNWARD_FACTOR : 1);
    penalized = true;
    outcome = "erratic";
  }

  // 3) Under-delivery — stacks on any pricing penalty above.
  if (fill < UNDERDELIVER_FILL) {
    loyalty -= DECAY_UNDERDELIVER;
    penalized = true;
    if (outcome === "held") outcome = "underdelivered";
  }

  // 4) Accrual — only when consistent, delivering, AND genuinely contested.
  if (!penalized && input.contested && absGap <= CONSISTENCY_BAND && fill >= DELIVER_FILL) {
    loyalty += ACCRUAL_RATE;
    accrued = true;
    outcome = "accrued";
  }

  // 5) Idle drift — neither earned nor punished this turn.
  if (!penalized && !accrued) {
    if (prior > LOYALTY_MIN) {
      loyalty -= DECAY_IDLE;
      outcome = "idle-decay";
    } else {
      outcome = "held";
    }
  }

  // 6) Clamp, then advance the norm EMA last.
  loyalty = clampLoyalty(loyalty);
  const postureNorm = norm + POSTURE_NORM_ALPHA * (posture - norm);

  return { loyalty, postureNorm, outcome };
}

/**
 * Boeing rule: losing a sector dents the brand proportional to that sector's
 * share of the corp's revenue. Returns the NEW loyalty. Pure.
 */
export function applyFacilityLoss(loyalty: number, lostRevenueShare: number): number {
  const l = clampLoyalty(loyalty);
  const share = Number.isFinite(lostRevenueShare) ? Math.max(0, Math.min(1, lostRevenueShare)) : 0;
  return clampLoyalty(l - l * share * FACILITY_LOSS_FACTOR);
}

/**
 * Is a seller genuinely undercut? True when some rival in the same market posts
 * at least CONTEST_GAP below the seller's own posture. Monopoly/priciest-tier
 * sellers with no cheaper rival are NOT contested, so they cannot accrue.
 */
export function isContested(sellerPosture: number, rivalPostures: readonly number[]): boolean {
  if (!Number.isFinite(sellerPosture)) return false;
  return rivalPostures.some((p) => Number.isFinite(p) && p <= sellerPosture - CONTEST_GAP);
}

export interface LoyalSliceSeller {
  id: string;
  loyalty: number;
  /** The seller's own lagged demand share (fraction of this market it would fill). */
  demandShare: number;
}

/**
 * Loyal-slice pre-pass for clearing. Splits the finite loyal pool
 * (LOYAL_POOL_FRACTION of demand) across sellers by RELATIVE loyalty, each
 * seller's slice capped at its own lagged demand share. Sellers below
 * SLICE_NOISE_FLOOR get nothing. Returns fraction-of-total-demand reserved per
 * seller (to be filled at that seller's own posted price BEFORE cheapest-first
 * clears the remainder).
 *
 * Relative by construction: if every seller has equal loyalty, each gets an
 * equal split — identical to no one having loyalty. The advantage only appears
 * when loyalties DIFFER, i.e. off rivals' mistakes.
 */
export function loyalSliceShares(sellers: readonly LoyalSliceSeller[]): Map<string, number> {
  const result = new Map<string, number>();
  const eligible = sellers.filter(
    (s) => clampLoyalty(s.loyalty) >= SLICE_NOISE_FLOOR && s.demandShare > 0
  );
  if (eligible.length === 0) return result;

  const totalLoyalty = eligible.reduce((sum, s) => sum + clampLoyalty(s.loyalty), 0);
  if (totalLoyalty <= 0) return result;

  for (const s of eligible) {
    const rawShare = LOYAL_POOL_FRACTION * (clampLoyalty(s.loyalty) / totalLoyalty);
    // Never reserve more of the market than this seller would actually fill.
    const capped = Math.min(rawShare, Math.max(0, Math.min(1, s.demandShare)));
    if (capped > 0) result.set(s.id, capped);
  }
  return result;
}
