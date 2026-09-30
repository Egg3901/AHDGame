import type { PrivateFirmSuccessionPlan } from "./privateFacilities";
import type { SuccessionFinancialPlan } from "./financialSettlement";

export interface SuccessionFiscalShare {
  entityId: string;
  kind: "continuing-state" | "background-successor" | "legacy-administration";
  /** Entitlement to source treasury cash, not a duplicate cash balance. */
  financialAssetEntitlementMinor: number;
  /** Contribution owed toward the unchanged issuer's creditor contracts. */
  creditorContributionMinor: number;
  /** Contract stock still serviced by the source or legacy administration. */
  servicingCreditorPrincipalMinor: number;
  cashDeficitResponsibilityMinor: number;
  facilityClaimLiabilityMinor: number;
  claimIds: string[];
}

function claimAmountMinor(value: number): number {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Facility claim must have a finite non-negative value");
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor))
    throw new Error("Facility claim exceeds shared accounting precision");
  return minor;
}

/** Build obligation shares without moving cash or rewriting a creditor. The
 * continuing issuer, or a legacy administration after full dissolution,
 * services existing bonds; successors owe their negotiated contributions. */
export function planSuccessionFiscalShares(input: {
  finances: SuccessionFinancialPlan;
  privateFirms: readonly PrivateFirmSuccessionPlan[];
}): SuccessionFiscalShare[] {
  const { finances, privateFirms } = input;
  const participants = Object.keys(finances.assetAllocation).sort();
  if (
    !finances.settlementId.trim() ||
    !finances.servicingIssuerId.trim() ||
    participants.length < 2 ||
    participants.some(
      (id) =>
        !Object.hasOwn(finances.debtResponsibility, id) ||
        !Object.hasOwn(finances.cashDeficitResponsibility, id)
    ) ||
    Object.keys(finances.debtResponsibility).length !== participants.length ||
    Object.keys(finances.cashDeficitResponsibility).length !== participants.length
  )
    throw new Error("Fiscal shares require a complete approved financial plan");
  const continuing = participants.includes(finances.servicingIssuerId);
  if (finances.servicingEntityKind !== (continuing ? "continuing-state" : "legacy-administration"))
    throw new Error("Fiscal issuer does not match the successor partition");
  const conserved = (amounts: Record<string, number>, total: number): boolean =>
    Number.isSafeInteger(total) &&
    total >= 0 &&
    Object.values(amounts).every((amount) => Number.isSafeInteger(amount) && amount >= 0) &&
    Object.values(amounts).reduce((sum, amount) => sum + BigInt(amount), BigInt(0)) ===
      BigInt(total);
  if (
    !conserved(finances.assetAllocation, finances.financialAssetsMinor) ||
    !conserved(finances.debtResponsibility, finances.creditorDebtMinor) ||
    !conserved(finances.cashDeficitResponsibility, finances.cashDeficitMinor)
  )
    throw new Error("Fiscal shares do not conserve approved balances");
  const claimsByDebtor = new Map<string, { amountMinor: number; ids: string[] }>();
  const seenClaims = new Set<string>();
  for (const firm of privateFirms) {
    for (const claim of firm.claims) {
      if (
        !firm.corporationId ||
        claim.corporationId !== firm.corporationId ||
        !claim.claimId.startsWith(`${finances.settlementId}:facility:`) ||
        seenClaims.has(claim.claimId) ||
        !participants.includes(claim.debtorEntityId) ||
        (continuing && claim.debtorEntityId === finances.servicingIssuerId)
      )
        throw new Error("Private facility claim is outside this approved settlement");
      seenClaims.add(claim.claimId);
      const current = claimsByDebtor.get(claim.debtorEntityId) ?? { amountMinor: 0, ids: [] };
      current.amountMinor += claimAmountMinor(claim.amountAnchor);
      if (!Number.isSafeInteger(current.amountMinor))
        throw new Error("Facility liability exceeds shared accounting precision");
      current.ids.push(claim.claimId);
      claimsByDebtor.set(claim.debtorEntityId, current);
    }
  }
  const shares: SuccessionFiscalShare[] = participants.map((entityId) => {
    const claims = claimsByDebtor.get(entityId);
    return {
      entityId,
      kind:
        continuing && entityId === finances.servicingIssuerId
          ? "continuing-state"
          : "background-successor",
      financialAssetEntitlementMinor: finances.assetAllocation[entityId],
      creditorContributionMinor: finances.debtResponsibility[entityId],
      servicingCreditorPrincipalMinor:
        continuing && entityId === finances.servicingIssuerId ? finances.creditorDebtMinor : 0,
      cashDeficitResponsibilityMinor: finances.cashDeficitResponsibility[entityId],
      facilityClaimLiabilityMinor: claims?.amountMinor ?? 0,
      claimIds: [...(claims?.ids ?? [])].sort(),
    } satisfies SuccessionFiscalShare;
  });
  if (!continuing)
    shares.push({
      entityId: finances.servicingIssuerId,
      kind: "legacy-administration",
      financialAssetEntitlementMinor: 0,
      creditorContributionMinor: 0,
      servicingCreditorPrincipalMinor: finances.creditorDebtMinor,
      cashDeficitResponsibilityMinor: 0,
      facilityClaimLiabilityMinor: 0,
      claimIds: [],
    });
  return shares.sort((a, b) => a.entityId.localeCompare(b.entityId));
}
