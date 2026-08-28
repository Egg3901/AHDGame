/**
 * A7 (first half), listing standards.
 *
 * Index eligibility is currently mechanical: be public, have a price, be in the
 * right country and sector. Nothing else. A shell corporation with two shares
 * outstanding and no business qualifies for the same index as a national
 * champion, and index funds will dutifully buy it.
 *
 * That matters more than it looks, because funds absorb public float. Inclusion
 * is a large, automatic, price-insensitive buyer, and today it is handed out on
 * no basis at all.
 *
 * Listing standards are the qualification bar: a free-float minimum, a size
 * minimum measured against the index's own median rather than an absolute
 * number, and a solvency screen. Clear them and the index buys you. Fall below
 * and it sells.
 *
 * ## The size bar is RELATIVE, deliberately
 *
 * An absolute ₳ floor would be wrong in two directions at once: meaningless in
 * a modern world, and impossible in a 1953 one where the whole economy is
 * smaller. Measuring against the median candidate makes the bar mean the same
 * thing, "not a rounding error next to your peers", in every era, with no
 * per-era constant to maintain.
 *
 * ## Exclusion is not instant
 *
 * A corporation that dips below the bar for one turn is not dumped. It must
 * fail for `GRACE_TURNS` consecutive observations. Without that, ordinary
 * price noise around the threshold would make funds churn the same position in
 * and out every turn, paying spread each way, the fund's holders would pay for
 * the volatility of the bar rather than of the business.
 */

/** Minimum share of a corporation's stock that must be in public hands. */
export const MIN_FREE_FLOAT_RATIO = 0.15;

/** Minimum market cap as a multiple of the candidate pool's MEDIAN cap. */
export const MIN_RELATIVE_SIZE = 0.05;

/** Consecutive failing observations before an existing constituent is dropped. */
export const LISTING_GRACE_TURNS = 3;

export type ListingFailure = "free_float" | "size" | "insolvent";

export interface ListingCandidate {
  corporationId: string;
  marketCapAnchor: number;
  /**
   * Shares held by the public rather than insiders/parents, over total shares.
   *
   * `undefined` means UNKNOWN, not zero, and never fails the screen. Plenty of
   * corporations carry no `publicFloat` at all; reading absent as zero would
   * exclude every one of them and empty every index on the first rebalance.
   * The screen exists to remove corporations that demonstrably fail a standard,
   * not ones we have no data on.
   */
  freeFloatRatio?: number;
  /** Negative liquid capital net of debt, a corp trading its way to zero. */
  insolvent: boolean;
}

export interface ListingVerdict {
  corporationId: string;
  qualifies: boolean;
  failures: ListingFailure[];
  /**
   * How close the candidate is to the WORST bar it misses, as observed over
   * required. 1 or more means it misses nothing measurable; `null` means the
   * miss could not be measured (an unwaivable failure, or no bar in force).
   *
   * A7 part 2 reads this: the index committee's automatic rule only tolerates a
   * marginal shortfall, and "marginal" has to be a number the screen computed
   * rather than one the committee guessed at.
   */
  worstShortfallRatio: number | null;
}

/** Median market cap of the candidate pool. Pure; empty pool gives 0. */
export function medianMarketCap(candidates: ListingCandidate[]): number {
  const caps = candidates
    .map((c) => c.marketCapAnchor)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (caps.length === 0) return 0;
  const mid = Math.floor(caps.length / 2);
  return caps.length % 2 === 0 ? (caps[mid - 1] + caps[mid]) / 2 : caps[mid];
}

/**
 * Judge every candidate against the standards.
 *
 * The median is computed over the WHOLE pool including failures. Computing it
 * over survivors only would be circular, dropping the small half raises the
 * median, which drops more, which raises it again.
 */
export function applyListingStandards(candidates: ListingCandidate[]): ListingVerdict[] {
  const median = medianMarketCap(candidates);
  const sizeFloor = median * MIN_RELATIVE_SIZE;

  return candidates.map((candidate) => {
    const failures: ListingFailure[] = [];

    // Fail OPEN on unknown float, see the field doc. A malformed number is a
    // different thing from an absent one and does fail.
    if (candidate.freeFloatRatio !== undefined) {
      if (
        !Number.isFinite(candidate.freeFloatRatio) ||
        candidate.freeFloatRatio < MIN_FREE_FLOAT_RATIO
      ) {
        failures.push("free_float");
      }
    }
    // A pool with no median (every cap zero or malformed) imposes no size bar
    // rather than excluding everyone, the screen should fail open on missing
    // data, not empty the index.
    if (sizeFloor > 0 && candidate.marketCapAnchor < sizeFloor) failures.push("size");
    if (candidate.insolvent) failures.push("insolvent");

    const ratios: number[] = [];
    if (failures.includes("free_float") && Number.isFinite(candidate.freeFloatRatio)) {
      ratios.push((candidate.freeFloatRatio as number) / MIN_FREE_FLOAT_RATIO);
    }
    if (failures.includes("size") && sizeFloor > 0) {
      ratios.push(candidate.marketCapAnchor / sizeFloor);
    }

    return {
      corporationId: candidate.corporationId,
      qualifies: failures.length === 0,
      failures,
      worstShortfallRatio: ratios.length > 0 ? Math.min(...ratios) : null,
    };
  });
}

/**
 * Should an EXISTING constituent be dropped?
 *
 * `consecutiveFailures` counts observations where the corp failed the standards,
 * including this one. New candidates are held to the bar immediately, the grace
 * period protects incumbents against noise, not applicants against the standard.
 */
export function shouldDropConstituent(consecutiveFailures: number): boolean {
  return consecutiveFailures >= LISTING_GRACE_TURNS;
}

/** One corporation's standing against the standards, carried between turns. */
export interface ListingFailureStreak {
  corporationId: string;
  consecutiveFailures: number;
  failures: ListingFailure[];
}

/**
 * Turn verdicts into what the index should actually hold, applying the grace
 * period to incumbents.
 *
 * The asymmetry is the point. An APPLICANT is held to the bar on the spot: a
 * shell corporation does not get three turns inside the index while it fails.
 * An INCUMBENT gets `LISTING_GRACE_TURNS` consecutive failing observations
 * before it is sold, so ordinary price noise around the bar does not make the
 * fund churn the same position in and out, paying spread each way.
 *
 * Pure, so the whole retention rule is testable without a database.
 */
export function applyListingRetention(params: {
  verdicts: ListingVerdict[];
  /** Corporations the fund already holds or already targets. */
  incumbentIds: Set<string>;
  /** Failure streaks recorded at the last rebalance. */
  priorStreaks: Map<string, number>;
}): {
  qualifiedIds: Set<string>;
  /** Streaks to persist. A corporation that qualifies is not carried at all. */
  streaks: ListingFailureStreak[];
  /** Incumbents that ran out of grace this turn. */
  droppedIds: string[];
} {
  const qualifiedIds = new Set<string>();
  const streaks: ListingFailureStreak[] = [];
  const droppedIds: string[] = [];

  for (const verdict of params.verdicts) {
    if (verdict.qualifies) {
      // Passing clears the record. Grace is for a run of failures, not a
      // lifetime tally, so one good turn resets the clock.
      qualifiedIds.add(verdict.corporationId);
      continue;
    }

    const consecutiveFailures = (params.priorStreaks.get(verdict.corporationId) ?? 0) + 1;
    streaks.push({
      corporationId: verdict.corporationId,
      consecutiveFailures,
      failures: verdict.failures,
    });

    if (!params.incumbentIds.has(verdict.corporationId)) continue;

    if (shouldDropConstituent(consecutiveFailures)) {
      droppedIds.push(verdict.corporationId);
    } else {
      qualifiedIds.add(verdict.corporationId);
    }
  }

  return { qualifiedIds, streaks, droppedIds };
}

/**
 * Materiality floor on the insolvency screen, as a fraction of market cap.
 *
 * A bare `liquidCapital < 0` flags a corporation that is a rounding error into
 * the red — measured in prod, a corp at -$2,657 against a $7.5M market cap was
 * called insolvent and kept out of every index, though it clears that shortfall
 * from one turn of revenue. A negative net-cash position is only a solvency
 * signal when it is material against what the corporation is worth.
 */
export const INSOLVENCY_MATERIALITY_FRACTION = 0.01;

/**
 * Whether a corporation is MATERIALLY insolvent: net liquid capital negative by
 * more than {@link INSOLVENCY_MATERIALITY_FRACTION} of its market cap. A corp
 * with no market value at all and negative cash is treated as insolvent (no
 * denominator to be immaterial against). `liquidCapital` and `marketCap` should
 * be the same-currency pair the caller already holds.
 */
export function isMateriallyInsolvent(
  liquidCapital: number | null | undefined,
  marketCap: number | null | undefined
): boolean {
  const cash = Number.isFinite(liquidCapital) ? (liquidCapital as number) : 0;
  if (cash >= 0) return false;
  const cap = Number.isFinite(marketCap) && (marketCap as number) > 0 ? (marketCap as number) : 0;
  if (cap <= 0) return true;
  return -cash > INSOLVENCY_MATERIALITY_FRACTION * cap;
}

/** Human-readable reason, for the corporation page and the fund's holdings list. */
export function describeFailure(failure: ListingFailure): string {
  switch (failure) {
    case "free_float":
      return `Less than ${Math.round(MIN_FREE_FLOAT_RATIO * 100)}% of shares are in public hands.`;
    case "size":
      return "Too small relative to the rest of the index.";
    case "insolvent":
      return "Balance sheet is insolvent.";
  }
}
