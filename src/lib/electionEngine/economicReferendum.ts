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
 * (k = 0.04). That made the old `partyTenureFatigue.ts` pipe (3.5 panel pts per
 * term, subtracted inside `incumbencyDriver`) near-inert in practice. This
 * channel replaced it: term fatigue now lives here as a penalty-side
 * multiplier, and the old pipe has been removed rather than left to double-count
 * a drag nobody could feel.
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

/**
 * One enacted bill offered to the credit-for-response gate.
 *
 * The DB-side loader (`src/lib/elections/responseCredit.ts`) has already
 * applied the two gates that need database access: a real budget cost, and
 * revocation when the component's metric kept worsening. What is left here is
 * ordering and the diminishing-returns decay, which is pure arithmetic.
 */
export interface ResponseCreditCandidate {
  /** Stable identifier for the bill (its id as a string). */
  key: string;
  title: string;
  /** Which {@link ReferendumComponent} key this bill pushes in the helpful direction. */
  component: string;
  /** Turn the bill was enacted. Earliest on a component earns full weight. */
  enactedTurn: number;
}

/** A bill that actually earned credit, with the weight it earned. */
export interface CreditedBill {
  key: string;
  title: string;
  component: string;
  /** Post-decay weight in [0, 1]. */
  weight: number;
}

export interface ResponseCreditOutcome {
  /** Share of the raw penalty forgiven, in [0, CREDIT_FORGIVENESS_MAX]. */
  forgivenessFrac: number;
  /** Points of penalty forgiven (>= 0). */
  forgivenessPts: number;
  creditedBills: CreditedBill[];
}

export interface ReferendumResult {
  /** Composite misery reading (sum of the excesses over each anchor). */
  miseryIndex: number;
  /** Final signed share shift for the incumbent party, in points. */
  sharePts: number;
  components: ReferendumComponent[];
  /** Multiplier applied to the PENALTY side only (never the bonus). */
  fatigueMultiplier: number;
  /**
   * Share of the raw penalty forgiven by credit-for-response. Absent or 0 when
   * no bill qualified.
   */
  forgivenessFrac?: number;
  /** The bills that earned the forgiveness, for the UI to show why. */
  creditedBills?: CreditedBill[];
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

/* ------------------------------------------------------------------ *
 * Credit for response.
 * ------------------------------------------------------------------ */

/**
 * Most of the raw penalty that visible crisis response can forgive. Voters
 * partially forgive a government that is demonstrably acting, because the
 * metrics lag by turns and the election does not wait for them.
 */
export const CREDIT_FORGIVENESS_MAX = 0.4;
/** Bills enacted within this many turns of the reading can earn credit. */
export const CREDIT_WINDOW_TURNS = 24;
/** Trailing window the revocation gate measures a component's metric over. */
export const CREDIT_REVOCATION_TURNS = 8;
/** Weight decay per additional qualifying bill on the same component. */
export const CREDIT_WEIGHT_DECAY = 0.5;

/**
 * Turn qualifying bills into a penalty-side forgiveness.
 *
 * Credit is scored PER COMPONENT, so a government that passed five jobs bills
 * cannot buy off an inflation penalty it never touched. Within a component the
 * first bill earns weight 1, the next 0.5, the next 0.25 and so on, and the
 * summed weight is capped at 1: a burst of token bills is worth barely more
 * than one real one.
 *
 * Forgiveness on a component is `|penalty| x CREDIT_FORGIVENESS_MAX x credit`,
 * so the relief lands hardest where the pain is, and the total can never
 * exceed {@link CREDIT_FORGIVENESS_MAX} of the raw penalty.
 *
 * Pure: no DB, no clock. The cost gate and the revocation gate run in the
 * loader and are expressed here as candidates simply being absent.
 */
export function applyResponseCredit(
  components: readonly ReferendumComponent[],
  candidates: readonly ResponseCreditCandidate[]
): ResponseCreditOutcome {
  const empty: ResponseCreditOutcome = {
    forgivenessFrac: 0,
    forgivenessPts: 0,
    creditedBills: [],
  };
  if (!candidates || candidates.length === 0) return empty;

  const penaltyByComponent = new Map<string, number>();
  for (const c of components) {
    if (c.contributionPts < 0) penaltyByComponent.set(c.key, -c.contributionPts);
  }
  const totalPenalty = [...penaltyByComponent.values()].reduce((s, v) => s + v, 0);
  if (totalPenalty <= 0) return empty;

  // Group by component, earliest enactment first so the bill that actually
  // responded to the downturn is the one that earns full weight.
  const byComponent = new Map<string, ResponseCreditCandidate[]>();
  for (const cand of candidates) {
    if (!penaltyByComponent.has(cand.component)) continue; // no penalty to forgive
    const list = byComponent.get(cand.component);
    if (list) list.push(cand);
    else byComponent.set(cand.component, [cand]);
  }

  const creditedBills: CreditedBill[] = [];
  let forgivenessPts = 0;

  for (const [componentKey, list] of byComponent) {
    const penalty = penaltyByComponent.get(componentKey) ?? 0;
    const ordered = [...list].sort(
      (a, b) => a.enactedTurn - b.enactedTurn || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    );
    let credit = 0;
    ordered.forEach((cand, index) => {
      const weight = Math.pow(CREDIT_WEIGHT_DECAY, index);
      credit += weight;
      creditedBills.push({
        key: cand.key,
        title: cand.title,
        component: cand.component,
        weight,
      });
    });
    forgivenessPts += penalty * CREDIT_FORGIVENESS_MAX * Math.min(1, credit);
  }

  return {
    forgivenessFrac: forgivenessPts / totalPenalty,
    forgivenessPts,
    creditedBills,
  };
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
 * side uses the same slopes, capped in total at {@link TOTAL_BONUS_CAP}.
 * `responseCredit` then forgives part of the penalty for visible crisis
 * response, and term fatigue scales what is left of the penalty side only. The
 * signed total is clamped to +/-{@link REFERENDUM_SHARE_CLAMP}.
 *
 * `era` is accepted for future era-specific anchors (a 6% natural rate is not
 * the same politics in 1953 as in 2020); it is currently unused and the anchors
 * above apply to every era.
 */
export function computeEconomicReferendum(
  inputs: MiseryInputs,
  consecutiveTerms: number | undefined,
  era?: string,
  responseCredit?: readonly ResponseCreditCandidate[]
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

  // Credit for response: an incumbent who visibly acted on the downturn keeps
  // part of the penalty back. Applied to the summed penalty BEFORE fatigue, so
  // the fatigue multiplier scales what is left rather than what was owed.
  const credit = applyResponseCredit(components, responseCredit ?? []);
  const forgivenPenalty = penalty + credit.forgivenessPts;

  const fatigueMultiplier = referendumFatigueMultiplier(consecutiveTerms);
  const sharePts = clampMagnitude(
    bonus + forgivenPenalty * fatigueMultiplier,
    REFERENDUM_SHARE_CLAMP
  );

  return {
    miseryIndex,
    sharePts,
    components,
    fatigueMultiplier,
    ...(credit.forgivenessFrac > 0 && {
      forgivenessFrac: credit.forgivenessFrac,
      creditedBills: credit.creditedBills,
    }),
  };
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
