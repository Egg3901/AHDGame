/**
 * Sovereign cash pays lawful claims before departments deliver services.
 * Unpaid authority stays owed to its claimant; bondholder shortfalls become
 * explicit emergency advances, not cash available to Cabinet programs.
 */
import { allocatePaidAuthority } from "./paidAuthority";
import { NATIONAL_CLAIM_PRIORITY, settleNationalTreasury } from "./settlement";
import type { NationalClaimCategory, NationalTurnInput } from "./settlement";
import type { ResetNationalTreasurySnapshot } from "./treasurySnapshot";

export interface CashAuthorityClaim {
  id: string;
  category: Exclude<NationalClaimCategory, "interest">;
  amount: number;
}

export function settleResetCashTurn(input: {
  treasury: ResetNationalTreasurySnapshot;
  turn: number;
  claims: readonly CashAuthorityClaim[];
  flows: Omit<NationalTurnInput, "operatingClaims">;
}): ResetNationalTreasurySnapshot {
  const { treasury, turn, claims, flows } = input;
  if (!Number.isSafeInteger(turn) || turn !== treasury.settledThroughTurn + 1) {
    throw new Error("Treasury cash must advance exactly one turn");
  }
  const ids = new Set<string>();
  const categories = { mandatory: 0, grants: 0, existing: 0, new: 0 };
  const prior = treasury.claimArrears ?? {};
  for (const claim of claims) {
    if (
      !claim.id ||
      ids.has(claim.id) ||
      !Object.hasOwn(categories, claim.category) ||
      !Number.isSafeInteger(claim.amount) ||
      claim.amount < 0 ||
      !Number.isSafeInteger(prior[claim.id] ?? 0) ||
      (prior[claim.id] ?? 0) < 0 ||
      !Number.isSafeInteger(claim.amount + (prior[claim.id] ?? 0))
    ) {
      throw new Error("Invalid cash authority claim");
    }
    ids.add(claim.id);
    categories[claim.category] += claim.amount;
    if (!Number.isSafeInteger(categories[claim.category])) throw new Error("Unsafe claim total");
  }
  if (Object.keys(prior).some((id) => !ids.has(id) && prior[id] !== 0)) {
    throw new Error("Treasury cannot discard an unpaid claimant");
  }
  for (const category of NATIONAL_CLAIM_PRIORITY.filter((entry) => entry !== "interest")) {
    const owed = claims
      .filter((claim) => claim.category === category)
      .reduce((sum, claim) => sum + (prior[claim.id] ?? 0), 0);
    if (!Number.isSafeInteger(owed) || owed !== treasury.arrears[category])
      throw new Error("Claim arrears do not reconcile");
  }
  const result = settleNationalTreasury(treasury, { ...flows, operatingClaims: categories });
  const lastPaidByClaim: Record<string, number> = {};
  const claimArrears: Record<string, number> = {};
  // A claimant is credited whole local-currency units. Fractional cash stays
  // in the sovereign bucket rather than being lost in departmental rounding.
  let retainedFraction = 0;
  for (const category of NATIONAL_CLAIM_PRIORITY.filter((entry) => entry !== "interest")) {
    const roster = claims
      .filter((claim) => claim.category === category)
      .map((claim) => ({
        id: claim.id,
        due: claim.amount + (prior[claim.id] ?? 0),
      }));
    const roundedPaid = Math.floor(result.paid[category]);
    retainedFraction += result.paid[category] - roundedPaid;
    const shares = allocatePaidAuthority(roundedPaid, roster);
    result.closing.arrears[category] =
      roster.reduce((sum, claim) => sum + claim.due, 0) - roundedPaid;
    result.paid[category] = roundedPaid;
    for (const claim of roster) {
      lastPaidByClaim[claim.id] = shares[claim.id]!;
      claimArrears[claim.id] = claim.due - shares[claim.id]!;
    }
  }
  const crisis =
    result.emergencyAdvanceDrawn > 0
      ? "emergency_advance"
      : result.ceilingExceeded
        ? "debt_ceiling"
        : null;
  return {
    ...treasury,
    ...result.closing,
    cash: result.closing.cash + retainedFraction,
    settledThroughTurn: turn,
    lastPaid: result.paid,
    lastEmergencyAdvanceDrawn: result.emergencyAdvanceDrawn,
    lastPaidByClaim,
    claimArrears,
    ...(crisis
      ? { fiscalCrisis: { sinceTurn: treasury.fiscalCrisis?.sinceTurn ?? turn, reason: crisis } }
      : {}),
  };
}
