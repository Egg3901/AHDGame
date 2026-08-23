/**
 * Economic referendum vote channel for executive OWN-races (presidential first).
 *
 * The question a re-election is really asking is "are you better off than you
 * were four years ago". This module prices that question as a single additive
 * share shift on the incumbent PARTY's candidate, computed from national misery
 * (unemployment, poverty, inflation, real-income trend) against era-tunable
 * anchors.
 *
 * WHY A NEW CHANNEL. The existing persuasion-driver incumbency channel is
 * measured ~10x too weak: drivers only peel the persuadable slice inside
 * `distributeVotesBySwingFlow`, so 10 budget pts buys about 0.4 share pts
 * (k = 0.04). That makes `partyTenureFatigue.ts` (3.5 panel pts per term,
 * subtracted inside `incumbencyDriver`) near-inert in practice. This channel
 * supersedes it pending a calibration decision; the old fatigue pipe is left in
 * place and functioning as-is so the two can be A/B'd before anything is
 * removed.
 *
 * APPLICATION RULES (learned from the rejected national-wave prototype):
 *   1. The shift is applied party-level at the share-combination step INSIDE the
 *      engine, computed ONCE per accumulation turn. It must never be re-applied
 *      at resolution or in the live-results drip (double-apply hazard).
 *   2. The offsetting mirror is split across the other candidates in proportion
 *      to their PRE-shift shares, never equally: an equal split triples fringe
 *      parties.
 *   3. Shares are renormalized to 100 and total votes are conserved.
 *
 * UNITS. Everything here is in percentage points of national vote share, not
 * the internal [-1, +1] driver-budget units used by `persuasionDrivers.ts`.
 */

/** National macro aggregates the referendum reads. All in display percent. */
export interface MiseryInputs {
  /** Headline unemployment, % of labour force. */
  unemploymentRate: number;
  /** Poverty rate, % of population. */
  povertyRate: number;
  /** Annual inflation RATE (not a price level), %. */
  inflationRate: number;
  /**
   * Trailing change in real median income, annualized percentage points.
   * Optional; treated as 0 (neutral) when absent.
   */
  realIncomeTrendPct?: number;
}

/** One row of the referendum gauge. */
export interface ReferendumComponent {
  key: string;
  label: string;
  /** Signed contribution to the incumbent's share, in percentage points. */
  contributionPts: number;
}

export interface ReferendumResult {
  /** Composite misery reading (sum of the excesses over each anchor). */
  miseryIndex: number;
  /** Final signed share shift for the incumbent party, in points. */
  sharePts: number;
  components: ReferendumComponent[];
  /** Multiplier applied to the PENALTY side only (never the bonus). */
  fatigueMultiplier: number;
}

/* ------------------------------------------------------------------ *
 * Anchors and slopes (era-tunable; exported so tests and the replay
 * harness pin the same numbers the engine uses).
 * ------------------------------------------------------------------ */

/** Unemployment at or below this is politically free. */
export const NATURAL_UNEMPLOYMENT_PCT = 6;
/** Poverty baseline; above this the incumbent starts paying. */
export const POVERTY_BASELINE_PCT = 20;
/** Inflation is free inside this band; outside it (either side) it bites. */
export const INFLATION_BAND_PCT: readonly [number, number] = [1, 4];
/** Real-income trend anchor: flat real incomes are neutral. */
export const INCOME_TREND_ANCHOR_PCT = 0;

/** Share points lost per point of unemployment above the natural rate. */
export const UNEMPLOYMENT_SLOPE = 0.6;
export const UNEMPLOYMENT_CAP = 4;
/** Share points lost per point of poverty above baseline. */
export const POVERTY_SLOPE = 0.15;
export const POVERTY_CAP = 3;
/** Share points lost per point of inflation outside the band (either side). */
export const INFLATION_SLOPE = 0.4;
export const INFLATION_CAP = 3;
/** Share points per point of real-income trend, symmetric. */
export const INCOME_TREND_SLOPE = 0.3;
export const INCOME_TREND_CAP = 1.5;

/** Total bonus (good-economy) side cap, before the final clamp. */
export const TOTAL_BONUS_CAP = 4;
/** Final clamp on the signed share shift. */
export const REFERENDUM_SHARE_CLAMP = 8;

/**
 * Penalty multiplier by the number of consecutive terms the party has ALREADY
 * held (the incumbent is seeking `consecutiveTerms + 1`). Applied to the
 * penalty side only: a long-tenured party gets no extra credit for a good
 * economy, but wears a worse one harder.
 */
export function referendumFatigueMultiplier(consecutiveTerms: number | undefined): number {
  if (consecutiveTerms == null || !Number.isFinite(consecutiveTerms)) return 1;
  const terms = Math.floor(consecutiveTerms);
  if (terms <= 1) return 1; // seeking a 2nd term
  if (terms === 2) return 1.25; // seeking a 3rd
  return 1.5; // seeking a 4th or beyond
}

function clampMagnitude(value: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, value));
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Price the economy as a share shift for the incumbent party.
 *
 * Positive = bonus to the incumbent, negative = penalty. Each component is
 * linear beyond its anchor with its own slope and its own cap; the good-economy
 * side uses the same slopes, capped in total at {@link TOTAL_BONUS_CAP}. Term
 * fatigue scales the penalty side only. The signed total is clamped to
 * +/-{@link REFERENDUM_SHARE_CLAMP}.
 *
 * `era` is accepted for future era-specific anchors (a 6% natural rate is not
 * the same politics in 1953 as in 2020); it is currently unused and the anchors
 * above apply to every era.
 */
export function computeEconomicReferendum(
  inputs: MiseryInputs,
  consecutiveTerms: number | undefined,
  era?: string
): ReferendumResult {
  void era; // reserved for era-specific anchors; see the doc comment above.
  const unemployment = finite(inputs.unemploymentRate, NATURAL_UNEMPLOYMENT_PCT);
  const poverty = finite(inputs.povertyRate, POVERTY_BASELINE_PCT);
  const inflation = finite(inputs.inflationRate, INFLATION_BAND_PCT[0]);
  const incomeTrend = finite(inputs.realIncomeTrendPct, INCOME_TREND_ANCHOR_PCT);

  const unemploymentExcess = unemployment - NATURAL_UNEMPLOYMENT_PCT;
  const povertyExcess = poverty - POVERTY_BASELINE_PCT;
  const inflationExcess =
    inflation > INFLATION_BAND_PCT[1]
      ? inflation - INFLATION_BAND_PCT[1]
      : inflation < INFLATION_BAND_PCT[0]
        ? INFLATION_BAND_PCT[0] - inflation
        : 0;
  const incomeExcess = incomeTrend - INCOME_TREND_ANCHOR_PCT;

  const components: ReferendumComponent[] = [
    {
      key: "unemployment",
      label: "Unemployment",
      contributionPts: clampMagnitude(-UNEMPLOYMENT_SLOPE * unemploymentExcess, UNEMPLOYMENT_CAP),
    },
    {
      key: "poverty",
      label: "Poverty",
      contributionPts: clampMagnitude(-POVERTY_SLOPE * povertyExcess, POVERTY_CAP),
    },
    {
      key: "inflation",
      label: "Inflation",
      // Inflation outside the band is always a penalty (deflation hurts too),
      // so the excess is a magnitude and never earns a bonus.
      contributionPts: clampMagnitude(-INFLATION_SLOPE * inflationExcess, INFLATION_CAP),
    },
    {
      key: "incomeTrend",
      label: "Real incomes",
      contributionPts: clampMagnitude(INCOME_TREND_SLOPE * incomeExcess, INCOME_TREND_CAP),
    },
  ];

  // Misery composite for display: the summed excess over each anchor, with a
  // falling real income counted as misery.
  const miseryIndex =
    Math.max(0, unemploymentExcess) +
    Math.max(0, povertyExcess) +
    inflationExcess +
    Math.max(0, -incomeExcess);

  const penalty = components.reduce((s, c) => s + Math.min(0, c.contributionPts), 0);
  const rawBonus = components.reduce((s, c) => s + Math.max(0, c.contributionPts), 0);
  const bonus = Math.min(TOTAL_BONUS_CAP, rawBonus);

  const fatigueMultiplier = referendumFatigueMultiplier(consecutiveTerms);
  const sharePts = clampMagnitude(bonus + penalty * fatigueMultiplier, REFERENDUM_SHARE_CLAMP);

  // TODO(referendum): credit-for-response forgiveness, see design doc. An
  // incumbent who visibly acted on the downturn (relief spending, rate moves)
  // should recover part of the penalty; that mechanic plugs in here, between
  // the raw penalty and the fatigue multiplier.

  return { miseryIndex, sharePts, components, fatigueMultiplier };
}

/**
 * Presentational breakdown for the UI gauge. Parallel to
 * `getPersuasionDriverBreakdown` in `persuasionDrivers.ts`: same shape of job,
 * already in percentage points, so a card can render it without recomputing.
 */
export function getReferendumBreakdown(result: ReferendumResult): ReferendumComponent[] {
  return [
    ...result.components,
    {
      key: "total",
      label: "Economic referendum",
      contributionPts: result.sharePts,
    },
  ];
}

/**
 * Apply a referendum share shift to one unit's vote map, party-level.
 *
 * `votesByCandidate` is any per-candidate vote/weight map for a single unit.
 * The incumbent party's candidates gain `sharePts` of the unit total between
 * them (split in proportion to their own pre-shift shares when the party runs
 * more than one); every other candidate loses in proportion to its pre-shift
 * share, so no fringe candidate is disproportionately hit or helped. The unit
 * total is conserved exactly (up to floating point) and no candidate goes
 * negative.
 */
export function applyReferendumShift(
  votesByCandidate: Record<string, number>,
  incumbentCandidateIds: readonly string[],
  sharePts: number
): Record<string, number> {
  if (!Number.isFinite(sharePts) || sharePts === 0) return votesByCandidate;
  const incumbentSet = new Set(incumbentCandidateIds);
  const total = Object.values(votesByCandidate).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  if (total <= 0) return votesByCandidate;

  const incumbentTotal = Object.entries(votesByCandidate)
    .filter(([id]) => incumbentSet.has(id))
    .reduce((s, [, v]) => s + (v > 0 ? v : 0), 0);
  const otherTotal = total - incumbentTotal;
  if (incumbentTotal <= 0 || otherTotal <= 0) return votesByCandidate;

  // Requested transfer in votes, bounded by what either side actually has so
  // the result stays non-negative on both sides.
  let transfer = (sharePts / 100) * total;
  if (transfer > 0) transfer = Math.min(transfer, otherTotal);
  else transfer = -Math.min(-transfer, incumbentTotal);

  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(votesByCandidate)) {
    const v = raw > 0 ? raw : 0;
    if (incumbentSet.has(id)) {
      out[id] = v + transfer * (v / incumbentTotal);
    } else {
      out[id] = v - transfer * (v / otherTotal);
    }
  }
  return out;
}
