/**
 * Union political contributions: a per-turn cut of remaining operating budget,
 * paid to organizers in proportion to their influence.
 *
 * Remaining budget is this turn's free cash flow (dues income minus the
 * service bill that actually ran). The head sets a percentage of that flow,
 * never a percentage of the treasury stock, so the same slider means the same
 * thing against a 48-turn year as against a dues credit. Capped at 50% of
 * free cash flow so a union cannot empty itself into campaign accounts.
 *
 * Members dislike dues being spent on politics. The approval penalty scales
 * with the slider and tops out at 5 points at the 50% cap.
 */

/** Highest share of free cash flow a union may send to organizers each turn. */
export const MAX_POLITICAL_CONTRIBUTION_OF_FCF = 0.5;

/** Approval points lost when the slider is at the 50% cap. */
export const MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY = 5;

function finiteNonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Stored rate, treating a missing field as none and clamping into [0, 0.5]. */
export function clampPoliticalContributionPct(pct: number | undefined): number {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(MAX_POLITICAL_CONTRIBUTION_OF_FCF, pct));
}

/**
 * This turn's remaining operating budget: dues that came in, minus the service
 * bill that actually ran. Negative surplus is remaining of zero, political
 * contributions never spend the treasury stock.
 */
export function freeCashFlowPerTurn(duesIncome: number, servicesCost: number): number {
  return Math.max(0, finiteNonNegative(duesIncome) - finiteNonNegative(servicesCost));
}

/** Cash leaving the treasury this turn at the given rate. */
export function politicalContributionPerTurn(
  freeCashFlow: number,
  pct: number | undefined
): number {
  return finiteNonNegative(freeCashFlow) * clampPoliticalContributionPct(pct);
}

/**
 * Approval points the membership withholds for this rate. Linear from 0 at
 * no contributions to {@link MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY} at
 * the 50% cap.
 */
export function politicalContributionApprovalPenalty(pct: number | undefined): number {
  const clamped = clampPoliticalContributionPct(pct);
  if (clamped <= 0) return 0;
  return (
    (clamped / MAX_POLITICAL_CONTRIBUTION_OF_FCF) * MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY
  );
}

export interface InfluenceShare {
  characterId: string;
  strength: number;
}

export interface ContributionPayout {
  characterId: string;
  amount: number;
}

/**
 * Split a contribution pool by organizer influence (banked strength). An
 * organizer with 40% of the pool's strength receives 40% of the cash. Zero
 * strength is excluded from the denominator so it cannot dilute people who
 * actually organized. The last share absorbs leftover float so the credits
 * sum to the debit.
 */
export function distributePoliticalContributions(
  total: number,
  shares: readonly InfluenceShare[]
): ContributionPayout[] {
  const amount = finiteNonNegative(total);
  if (amount <= 0) return [];

  const eligible = shares
    .filter((s) => finiteNonNegative(s.strength) > 0 && typeof s.characterId === "string")
    .slice()
    .sort((a, b) => (a.characterId < b.characterId ? -1 : a.characterId > b.characterId ? 1 : 0));

  const weight = eligible.reduce((sum, s) => sum + s.strength, 0);
  if (weight <= 0) return [];

  const out: ContributionPayout[] = [];
  let allocated = 0;
  for (let i = 0; i < eligible.length; i++) {
    const isLast = i === eligible.length - 1;
    const piece = isLast ? amount - allocated : amount * (eligible[i].strength / weight);
    allocated += piece;
    if (piece > 0) out.push({ characterId: eligible[i].characterId, amount: piece });
  }
  return out;
}
