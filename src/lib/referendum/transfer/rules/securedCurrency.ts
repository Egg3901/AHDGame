import type { CorporateSector } from "@/lib/db/types/corporation";
/** Existing collateral keeps its contractual native currency; pending builds must be resolved first. */
export function retainsCompletedSecuredCurrency(
  sectors: Array<
    Pick<CorporateSector, "constructionFinancing" | "constructionPropertyTransition" | "buildQueue">
  >
): boolean {
  let retains = false;
  for (const sector of sectors) {
    if (sector.constructionPropertyTransition)
      throw new Error("Construction property settlement remains pending");
    const claim = sector.constructionFinancing;
    if (!claim || ["released", "cancelled"].includes(claim.status)) continue;
    if (
      claim.status !== "building" ||
      !claim.fundingCleanupCompleted ||
      claim.escrowLocal !== 0 ||
      sector.buildQueue?.some((order) => order.constructionClaimId === claim.claimId) ||
      (claim.cancellation && !claim.cancellation.cleanupCompleted)
    )
      throw new Error("Pending financed construction remains at conversion");
    retains = true;
  }
  return retains;
}
