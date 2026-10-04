import type { CorporateSector } from "@/lib/db/types";

/**
 * A financed construction pledge remains attached to its sector until the
 * loan has been released or cancelled, its escrow is empty, and any staged
 * cancellation cleanup has completed. Malformed or unknown claims fail closed
 * because ownership changes must not erase a lender's collateral record.
 */
export function hasProtectedConstructionProperty(
  sector: Pick<CorporateSector, "constructionFinancing" | "constructionPropertyTransition">
): boolean {
  if (sector.constructionPropertyTransition) return true;
  return hasProtectedConstructionClaim(sector);
}

export function hasProtectedConstructionClaim(
  sector: Pick<CorporateSector, "constructionFinancing">
): boolean {
  const claim = sector.constructionFinancing;
  if (!claim) return false;

  const escrow = claim.escrowLocal;
  if (typeof escrow !== "number" || !Number.isFinite(escrow) || escrow !== 0) return true;
  if (claim.status !== "released" && claim.status !== "cancelled") return true;
  if (claim.cancellation && claim.cancellation.cleanupCompleted !== true) return true;
  return false;
}

/** Mongo predicate that matches only sectors with no active secured claim. */
export function unprotectedConstructionPropertyFilter(): Record<string, unknown> {
  return {
    $and: [
      { constructionPropertyTransition: { $exists: false } },
      {
        $or: [
          { constructionFinancing: { $exists: false } },
          {
            $and: [
              { "constructionFinancing.status": { $in: ["released", "cancelled"] } },
              { "constructionFinancing.escrowLocal": 0 },
              {
                $or: [
                  { "constructionFinancing.cancellation": { $exists: false } },
                  { "constructionFinancing.cancellation.cleanupCompleted": true },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function hasProtectedConstructionPropertyIn(
  sectors: Array<Pick<CorporateSector, "constructionFinancing" | "constructionPropertyTransition">>
): boolean {
  return sectors.some(hasProtectedConstructionProperty);
}
