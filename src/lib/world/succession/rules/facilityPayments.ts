/**
 * Successor facility compensation uses available treasury after bond servicing.
 * planFacilityPayments shares scarce cash proportionally, carries unpaid claims
 * forward and conserves every shared-accounting minor unit without borrowing.
 */
import { allocateSuccessionAmount } from "./financialSettlement";

export interface FacilityPaymentClaim {
  id: string;
  amountMinor: number;
  paidMinor: number;
}

export function planFacilityPayments(
  treasuryMinor: number,
  claims: readonly FacilityPaymentClaim[]
) {
  if (!Number.isSafeInteger(treasuryMinor)) throw new Error("Invalid successor treasury");
  const weights: Record<string, number> = Object.create(null);
  let outstanding = BigInt(0);
  for (const claim of claims) {
    if (
      !claim.id ||
      Object.hasOwn(weights, claim.id) ||
      !Number.isSafeInteger(claim.amountMinor) ||
      claim.amountMinor < 0 ||
      !Number.isSafeInteger(claim.paidMinor) ||
      claim.paidMinor < 0 ||
      claim.paidMinor > claim.amountMinor
    )
      throw new Error("Invalid facility payment claim");
    weights[claim.id] = claim.amountMinor - claim.paidMinor;
    outstanding += BigInt(weights[claim.id]);
  }
  const paidMinor = Number(
    outstanding < BigInt(Math.max(0, treasuryMinor))
      ? outstanding
      : BigInt(Math.max(0, treasuryMinor))
  );
  const allocations =
    outstanding > BigInt(0)
      ? allocateSuccessionAmount(paidMinor, weights)
      : Object.fromEntries(claims.map((claim) => [claim.id, 0]));
  return {
    paidMinor,
    treasuryAfterMinor: treasuryMinor - paidMinor,
    claims: claims.map((claim) => ({
      id: claim.id,
      paymentMinor: allocations[claim.id],
      paidMinor: claim.paidMinor + allocations[claim.id],
      complete: claim.paidMinor + allocations[claim.id] === claim.amountMinor,
    })),
  };
}
