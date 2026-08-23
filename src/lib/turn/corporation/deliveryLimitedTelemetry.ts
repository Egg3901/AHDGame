import type { FreightClass } from "@/lib/logistics/freightClass";
import type { CorporateSector } from "@/lib/db/types";

/**
 * Reconcile the freight seam's delivery-limited share with the sector's own
 * fill, so the two numbers the row shows side by side cannot contradict.
 *
 * A plain glut is NOT in this number and never was: the sourcing pass only
 * attributes spare against residual unmet demand, because the sector surface
 * reads this figure as "buyers still wanted it" and tells the player to fix
 * delivery rather than cut output. Telling the owner of a glutted sector to
 * build freight is worse than telling them nothing.
 *
 * The seam measures a STATE's unplaced production against that state's whole
 * supply. Fill measures what THIS sector sold against what it produced. They
 * are computed on different bases, and at t318 that gap was visible on 1,211
 * of 1,368 flagged sectors live (88.5%): a row reading "Fill 100%" beside a
 * pill reading "Delivery limited 96%", with 517 of them above 90%.
 *
 * The gap is the offer haircut. `placementRatioForSector` shrinks a sector's
 * OFFER into the clearing book, so clearing clears the shrunken offer at ~100%
 * and `soldFraction` comes back 1; that fraction is then applied to full
 * production, so units and revenue book in full. The seam ratio, meanwhile, is
 * still measured against full state supply. Whether a stranded seller should
 * lose the revenue is an open owner decision on a live world (see the SCOPE
 * note in `turn/corporation/index.ts`) and is deliberately NOT settled here —
 * this only stops the display asserting a delivery failure against output the
 * same row says was sold.
 *
 * The clamp is the invariant the feature already documents everywhere it is
 * read: the pill is "the part of the FILL SHORTFALL that is a delivery
 * failure", and the sector page's money panel already clamps to unsold units
 * locally. `turn/corporation/index.ts` even asserts it ("it can never exceed
 * the haircut the offer took") — true against the offer basis, false against
 * the basis the row displays. This restores it on the displayed basis.
 *
 * Ledger-tier worlds pass `soldFraction: null`: clearing has not run, there is
 * no fill number for the seam to contradict, and that tier exists purely for
 * observability, so the raw state ratio passes through untouched.
 */
export function resolveDeliveryLimitedTelemetry(args: {
  /** Seam ratio for the sector's host state, or null when unmeasured. */
  stateRatio: number | null | undefined;
  /** `clearing.soldFraction` when the clearing pre-pass ran, else null. */
  soldFraction: number | null | undefined;
  /** The binding output leg's freight class, when the seam named one. */
  freightClass: FreightClass | null | undefined;
}): { fraction: number; freightClass: FreightClass | null } {
  const { stateRatio, soldFraction, freightClass } = args;
  const raw =
    typeof stateRatio === "number" && Number.isFinite(stateRatio)
      ? Math.max(0, Math.min(1, stateRatio))
      : 0;

  // Clamp only where a fill number exists to contradict. `soldFraction` IS the
  // displayed fill rate (soldUnits = producedUnits x soldFraction, and the chip
  // divides the two back out), so its complement is exactly the shortfall the
  // pill claims to be explaining.
  const unsoldShare =
    typeof soldFraction === "number" && Number.isFinite(soldFraction)
      ? Math.max(0, 1 - Math.max(0, Math.min(1, soldFraction)))
      : 1;

  const fraction = Math.round(Math.min(raw, unsoldShare) * 1000) / 1000;
  // A zero share has no binding leg to name, and leaving a stale class behind
  // would hand the read surfaces a label for a pill they no longer render.
  return { fraction, freightClass: fraction > 0 ? (freightClass ?? null) : null };
}

/**
 * The `$set` fragment for one sector's freight-seam telemetry (t225), in the
 * same shape as `marketTelemetry` so `sectorTurn` stays a list of assignments.
 *
 * Only settlement worlds populate the seam maps, so a world with settlement off
 * writes nothing new — except to clear a value it wrote while settlement was
 * on, which would otherwise sit stale on the sector forever.
 */
export function deliveryLimitedTelemetry(input: {
  sector: Pick<CorporateSector, "deliveryLimitedFraction">;
  stateRatio: number | null | undefined;
  soldFraction: number | null | undefined;
  freightClass: FreightClass | null | undefined;
}): Record<string, unknown> {
  const { sector, stateRatio, soldFraction, freightClass } = input;
  if (stateRatio == null && typeof sector.deliveryLimitedFraction !== "number") return {};
  const resolved = resolveDeliveryLimitedTelemetry({ stateRatio, soldFraction, freightClass });
  return {
    deliveryLimitedFraction: resolved.fraction,
    deliveryLimitedFreightClass: resolved.freightClass,
  };
}
