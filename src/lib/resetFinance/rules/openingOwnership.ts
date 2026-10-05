/** One opening fiscal owner per source cost, including obligations without a 1991 law. */
export interface OpeningOwnershipClaim {
  sourceId: string;
  familyId: string | null;
  amount: number;
  disposition: string;
  treatment: string;
}

export interface OpeningContinuityAccount {
  id: string;
  sourceId: string;
  amount: number;
}

export function reconcileOpeningOwnership(
  operating: number,
  claims: readonly OpeningOwnershipClaim[],
  standaloneContinuity: readonly OpeningContinuityAccount[] = []
) {
  if (!Number.isFinite(operating) || operating < 0) {
    throw new Error("opening operating total must be finite and nonnegative");
  }
  const seen = new Set<string>();
  const familyTotals = new Map<string, number>();
  const continuity: OpeningContinuityAccount[] = [];
  for (const claim of claims) {
    if (!claim.sourceId || seen.has(claim.sourceId)) {
      throw new Error(`duplicate or empty opening fiscal source ${claim.sourceId}`);
    }
    seen.add(claim.sourceId);
    if (!Number.isFinite(claim.amount) || claim.amount < 0) {
      throw new Error(`invalid opening fiscal amount for ${claim.sourceId}`);
    }
    if (
      claim.disposition !== "retained-legal-lineage" &&
      claim.disposition !== "not-adopted-as-1991-law"
    ) {
      throw new Error(`invalid opening fiscal disposition for ${claim.sourceId}`);
    }
    if (claim.disposition === "not-adopted-as-1991-law") {
      if (claim.treatment === "retained-opening-obligation") {
        continuity.push({
          id: `${claim.sourceId}_continuity`,
          sourceId: claim.sourceId,
          amount: claim.amount,
        });
      } else if (claim.amount !== 0) {
        throw new Error(`excluded law has an unexplained cost: ${claim.sourceId}`);
      }
    } else if (claim.familyId) {
      familyTotals.set(claim.familyId, (familyTotals.get(claim.familyId) ?? 0) + claim.amount);
    } else if (claim.amount !== 0) {
      throw new Error(`booked source has no fiscal family: ${claim.sourceId}`);
    }
  }
  for (const account of standaloneContinuity) {
    if (!account.id || !account.sourceId || seen.has(account.sourceId)) {
      throw new Error(`duplicate or empty continuity source ${account.sourceId}`);
    }
    if (!Number.isFinite(account.amount) || account.amount < 0) {
      throw new Error(`invalid continuity amount for ${account.sourceId}`);
    }
    seen.add(account.sourceId);
    continuity.push(account);
  }
  const familyOwned = [...familyTotals.values()].reduce((sum, amount) => sum + amount, 0);
  const continuityOwned = continuity.reduce((sum, account) => sum + account.amount, 0);
  const gap = operating - familyOwned - continuityOwned;
  if (Math.abs(gap) > 0.01) {
    throw new Error(`opening fiscal ownership gap ${gap}`);
  }
  return {
    operating,
    familyOwned,
    continuityOwned,
    familyTotals: Object.fromEntries(familyTotals),
    continuity,
  };
}
