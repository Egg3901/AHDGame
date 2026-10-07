/**
 * Conserved sovereign financing (#3381) for Cabinet-v2 countries. The funded
 * Treasury balance (`federalBudget.treasuryCashLocal`) is the only spendable
 * cash. Bond proceeds, coupons and maturities have already moved that balance
 * by the time this runs, so they are NOT added or subtracted again here; the
 * reset book's own `cash`, revenue credit and appropriation financing are not
 * used. Claims are paid in priority order from the funded balance and every
 * unpaid amount stays an explicit per-claimant arrear.
 *
 * The receipt is a plan until its single cash leg lands. `cash` is rewritten
 * as a non-owning projection of the funded balance after payment, and `debt`
 * tracks bond face only (analytics, never cash).
 */
import { allocatePaidAuthority } from "./paidAuthority";
import { NATIONAL_CLAIM_PRIORITY } from "./settlement";
import type { CashAuthorityClaim } from "./cashTurn";
import type { ResetNationalTreasurySnapshot } from "./treasurySnapshot";

export function settleConservedResetCashTurn(input: {
  treasury: ResetNationalTreasurySnapshot;
  turn: number;
  claims: readonly CashAuthorityClaim[];
  /** Funded Treasury cash read after bond settlement. */
  fundedCash: number;
  /** This turn's captured bond face, for the debt book only. */
  bondFaceIssued?: number;
  bondFaceRetired?: number;
}): ResetNationalTreasurySnapshot {
  const { treasury, turn, claims } = input;
  if (!Number.isSafeInteger(turn) || turn !== treasury.settledThroughTurn + 1) {
    throw new Error("Treasury cash must advance exactly one turn");
  }
  if (!Number.isFinite(input.fundedCash)) throw new Error("Funded Treasury cash is not finite");
  const prior = treasury.claimArrears ?? {};
  const ids = new Set<string>();
  for (const claim of claims) {
    const owed = prior[claim.id] ?? 0;
    if (
      !claim.id ||
      ids.has(claim.id) ||
      claim.category === ("interest" as string) ||
      !Number.isSafeInteger(claim.amount) ||
      claim.amount < 0 ||
      !Number.isSafeInteger(owed) ||
      owed < 0 ||
      !Number.isSafeInteger(claim.amount + owed)
    ) {
      throw new Error("Invalid cash authority claim");
    }
    ids.add(claim.id);
  }
  if (Object.keys(prior).some((id) => !ids.has(id) && prior[id] !== 0)) {
    throw new Error("Treasury cannot discard an unpaid claimant");
  }
  // Whole units only; the fraction stays in Treasury cash.
  let remaining = Math.max(0, Math.floor(input.fundedCash));
  const lastPaid = { interest: 0, mandatory: 0, grants: 0, existing: 0, new: 0 };
  const arrears = { ...treasury.arrears };
  const lastPaidByClaim: Record<string, number> = {};
  const claimArrears: Record<string, number> = {};
  for (const category of NATIONAL_CLAIM_PRIORITY.filter((entry) => entry !== "interest")) {
    const roster = claims
      .filter((claim) => claim.category === category)
      .map((claim) => ({ id: claim.id, due: claim.amount + (prior[claim.id] ?? 0) }));
    const due = roster.reduce((sum, claim) => sum + claim.due, 0);
    const paid = Math.min(due, remaining);
    remaining -= paid;
    const shares = allocatePaidAuthority(paid, roster);
    lastPaid[category] = paid;
    arrears[category] = due - paid;
    for (const claim of roster) {
      lastPaidByClaim[claim.id] = shares[claim.id]!;
      claimArrears[claim.id] = claim.due - shares[claim.id]!;
    }
  }
  const paidTotal = Object.values(lastPaidByClaim).reduce((sum, value) => sum + value, 0);
  const faceIssued = input.bondFaceIssued ?? 0;
  const faceRetired = input.bondFaceRetired ?? 0;
  if (
    ![faceIssued, faceRetired].every((value) => Number.isFinite(value) && value >= 0) ||
    faceRetired > treasury.debt + faceIssued
  )
    throw new Error("Invalid sovereign face flow");
  return {
    ...treasury,
    cash: Math.max(0, input.fundedCash) - paidTotal,
    debt: treasury.debt + faceIssued - faceRetired,
    arrears,
    settledThroughTurn: turn,
    lastPaid,
    lastEmergencyAdvanceDrawn: 0,
    lastAppropriationFinancing: 0,
    lastPaidByClaim,
    claimArrears,
    conservedFunding: {
      turn,
      fundedCash: input.fundedCash,
      paidTotal,
      plannedTotal: paidTotal,
      status: "planned",
    },
  };
}

/**
 * The cash leg for a planned receipt was wholly refused (a concurrent
 * Treasury spend left less than the frozen amount). Nothing moved, so the
 * turn books zero authority and every planned payment returns to its
 * claimant's arrears. Paid legs never reach here: a partial move resumes.
 */
export function unpaidConservedReceipt(
  planned: ResetNationalTreasurySnapshot
): ResetNationalTreasurySnapshot {
  const funding = planned.conservedFunding;
  if (!funding || funding.status !== "planned" || !planned.lastPaidByClaim || !planned.lastPaid)
    throw new Error("Only a planned conserved receipt can fall back to unpaid");
  const claimArrears: Record<string, number> = {};
  for (const [id, paid] of Object.entries(planned.lastPaidByClaim))
    claimArrears[id] = (planned.claimArrears?.[id] ?? 0) + paid;
  const arrears = { ...planned.arrears };
  const lastPaid = { ...planned.lastPaid };
  for (const category of Object.keys(lastPaid) as (keyof typeof lastPaid)[]) {
    arrears[category] += lastPaid[category];
    lastPaid[category] = 0;
  }
  return {
    ...planned,
    cash: planned.cash + funding.paidTotal,
    arrears,
    lastPaid,
    lastPaidByClaim: Object.fromEntries(Object.keys(claimArrears).map((id) => [id, 0])),
    claimArrears,
    conservedFunding: { ...funding, paidTotal: 0, status: "refused" },
  };
}
