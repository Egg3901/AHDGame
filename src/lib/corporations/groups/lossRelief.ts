/**
 * C4 — corporate groups: consolidated tax and loss relief.
 *
 * Each corporation is taxed alone. A group with a profitable parent and a
 * loss-making subsidiary therefore pays full tax on the profit while the loss
 * is simply wasted, which is not how a group is taxed anywhere and which makes
 * owning a struggling subsidiary strictly worse than owning nothing.
 *
 * Group relief fixes that: within one country, a group's losses are surrendered
 * against its profits, and the group pays tax on the net.
 *
 * ## Why this is a rebate rather than a recomputation
 *
 * The obvious implementation is to consolidate before tax is computed. That
 * would mean a second pass inside `sectorCalculations`, whose per-corp loop has
 * already derived income, dividends, liquid capital and the whole corp snapshot
 * from the tax figure. Unpicking that is a large change to the hottest path in
 * the turn for no behavioural gain: paying tax and then rebating the relieved
 * portion in the same turn is arithmetically identical to filing consolidated,
 * and it is additive rather than invasive.
 *
 * ## Same country only
 *
 * A loss in one country cannot shelter a profit in another. That is not a
 * simplification, it is the actual rule, and the cross-border version of this
 * question is transfer pricing (C5) rather than group relief.
 *
 * ## Formalized subsidiaries only
 *
 * De facto control is not a group for tax. The parent must have FORMALIZED the
 * subsidiary — an explicit, visible act that already exists. That gives
 * formalization a real payoff, and it means the same declaration that buys
 * relief is the one that makes the group legible to merger review.
 */

import type { ObjectId } from "mongodb";

/** One group member's tax position for a turn, in ₳. */
export interface GroupMemberTaxPosition {
  corporationId: ObjectId;
  countryId: string;
  /** Pre-tax income this turn. Negative for a loss. */
  incomePreTaxAnchor: number;
  /** Corporate tax actually charged this turn. */
  taxPaidAnchor: number;
}

export interface GroupReliefAllocation {
  corporationId: ObjectId;
  countryId: string;
  reliefAnchor: number;
}

export interface GroupReliefOutcome {
  allocations: GroupReliefAllocation[];
  totalReliefAnchor: number;
  /** Losses actually surrendered — useful for the group balance sheet. */
  lossesSurrenderedAnchor: number;
}

/**
 * Relief for ONE group in ONE country.
 *
 * The effective rate is DERIVED from what the group actually paid rather than
 * looked up, so relief cannot drift from the rates that really applied — which
 * vary by state, by sector location, and by legal structure (a pass-through
 * member pays nothing and correctly contributes nothing to the rate).
 */
export function computeGroupRelief(members: GroupMemberTaxPosition[]): GroupReliefOutcome {
  const empty: GroupReliefOutcome = {
    allocations: [],
    totalReliefAnchor: 0,
    lossesSurrenderedAnchor: 0,
  };
  if (members.length < 2) return empty;

  let totalProfit = 0;
  let totalLoss = 0;
  let totalTaxPaid = 0;
  for (const m of members) {
    if (!Number.isFinite(m.incomePreTaxAnchor)) continue;
    if (m.incomePreTaxAnchor > 0) totalProfit += m.incomePreTaxAnchor;
    else totalLoss += -m.incomePreTaxAnchor;
    if (Number.isFinite(m.taxPaidAnchor) && m.taxPaidAnchor > 0) totalTaxPaid += m.taxPaidAnchor;
  }
  if (totalLoss <= 0 || totalProfit <= 0 || totalTaxPaid <= 0) return empty;

  // A loss can only shelter profit that exists. Surrendering more would be a
  // carry-forward, which is a different mechanic with its own ledger.
  const lossesSurrendered = Math.min(totalLoss, totalProfit);
  const effectiveRate = totalTaxPaid / totalProfit;
  // Cap at the tax actually collected: relief is a refund of tax paid, never a
  // payment out of the treasury to a group that paid none.
  const totalRelief = Math.min(totalTaxPaid, lossesSurrendered * effectiveRate);
  if (totalRelief <= 0) return empty;

  // Allocate to the members who actually paid, in proportion to what they paid.
  const payers = members.filter((m) => Number.isFinite(m.taxPaidAnchor) && m.taxPaidAnchor > 0);
  const allocations: GroupReliefAllocation[] = [];
  let allocated = 0;
  payers.forEach((m, index) => {
    const isLast = index === payers.length - 1;
    // The last payer absorbs the rounding remainder, so the allocations sum
    // exactly to the relief and no ₳ is created or lost in the split.
    const share = isLast
      ? totalRelief - allocated
      : Math.floor((m.taxPaidAnchor / totalTaxPaid) * totalRelief);
    if (share <= 0) return;
    allocations.push({
      corporationId: m.corporationId,
      countryId: m.countryId,
      reliefAnchor: share,
    });
    allocated += share;
  });

  return {
    allocations,
    totalReliefAnchor: allocated,
    lossesSurrenderedAnchor: lossesSurrendered,
  };
}

/**
 * Group members by (group root, country). Members of the same group in
 * different countries form separate pools — same-country relief only.
 */
export function poolByGroupAndCountry(
  members: Array<GroupMemberTaxPosition & { groupRootId: string }>
): Map<string, GroupMemberTaxPosition[]> {
  const pools = new Map<string, GroupMemberTaxPosition[]>();
  for (const m of members) {
    const key = `${m.groupRootId}::${m.countryId}`;
    const pool = pools.get(key);
    if (pool) pool.push(m);
    else pools.set(key, [m]);
  }
  return pools;
}
