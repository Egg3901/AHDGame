import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { isStateOwned } from "./nationalCorporation";
import { privatizeAsset } from "./privatizeAsset";

export interface ReverseNationalizationParams {
  countryId: string;
  /** Surviving NatCorp sector rows to return to private hands (see NationalizeSectorResult.resultingSectorId). */
  sectorIds: ObjectId[];
  turn: number;
  /** Short label used to name a fallback spin-out corp when no prior owner survives. */
  label: string;
}

export interface ReverseNationalizationResult {
  /** Sectors handed back to their originally-recorded prior owner. */
  restoredToPriorOwner: number;
  /** Sectors returned to private hands via a fresh spin-out (no prior owner). */
  spunOut: number;
  /** Sectors skipped (already private, missing, or the return threw). */
  skipped: number;
}

/**
 * Reverse an emergency nationalization taking: return the named sectors to
 * PRIVATE hands. Called when the Supreme Court strikes down an executive taking
 * (`scotusDocketTurn` on a diverged case carrying `nationalizationReversal`).
 *
 * For each surviving NatCorp sector row:
 *   - If `nationalizationProvenance.formerCorporationId` is recorded and that
 *     corporation still exists, RE-PARENT the row back to it and restore its
 *     pre-haircut economics, clearing the nationalization stamps. This is the
 *     literal "undo the taking".
 *   - Otherwise (prior owner dissolved, or a legacy row with no provenance) fall
 *     back to the normal privatization path (`privatizeAsset`, IPO) so the asset
 *     still leaves state hands. The re-privatization cooldown is bypassed here —
 *     a court order overrides it — by clearing `absorbedAtTurn` first.
 *
 * Sectors already back in private hands (idempotent re-runs) and missing rows are
 * skipped. Best-effort: a per-sector throw is caught and counted as skipped so a
 * single bad row never wedges the docket turn.
 */
export async function reverseNationalizationTaking(
  db: Db,
  params: ReverseNationalizationParams
): Promise<ReverseNationalizationResult> {
  const now = new Date();
  const sectorsCol = db.collection<CorporateSector>("corporateSectors");
  const corps = db.collection<Corporation>("corporations");

  let restoredToPriorOwner = 0;
  let spunOut = 0;
  let skipped = 0;

  for (const sectorId of params.sectorIds) {
    try {
      const sector = await sectorsCol.findOne({ _id: sectorId });
      if (!sector) {
        skipped++;
        continue;
      }

      // Only reverse a sector that is STILL held by a state-owned NatCorp of this
      // country. A row already handed back (idempotent re-run) is left alone.
      const holder = await corps.findOne({ _id: sector.corporationId });
      if (!holder || !isStateOwned(holder) || holder.countryOwnerId !== params.countryId) {
        skipped++;
        continue;
      }

      const prov = sector.nationalizationProvenance;
      const priorOwner = prov?.formerCorporationId
        ? await corps.findOne({ _id: prov.formerCorporationId })
        : null;

      if (prov && priorOwner && !priorOwner._id.equals(holder._id)) {
        // Re-parent to the recorded prior owner and restore pre-haircut economics.
        //
        // PLANTS-GATED: the `revenue` write below is the LEGACY nameplate, not
        // the quantity. `formerCapitalStock` is restored in the same `$set`, and
        // under plants `sectorTurn` restates revenue from owned capacity on the
        // next tick, so the nameplate converges on the restored capacity rather
        // than being double-counted against it. Restoring capacity without
        // revenue would leave a stale pre-haircut nameplate visible for one
        // turn; restoring revenue without capacity would be erased. Both, in one
        // write, is the correct pairing.
        await sectorsCol.updateOne(
          { _id: sector._id },
          {
            $set: {
              corporationId: priorOwner._id,
              ...(typeof prov.formerRevenue === "number" ? { revenue: prov.formerRevenue } : {}),
              ...(typeof prov.formerCapitalStock === "number"
                ? { capitalStock: prov.formerCapitalStock }
                : {}),
              updatedAt: now,
            },
            $unset: {
              absorbedAtTurn: "",
              nationalizedAtTurn: "",
              nationalizationTransitionMultiplier: "",
              nationalizationProvenance: "",
            },
          }
        );
        restoredToPriorOwner++;
        continue;
      }

      // Fallback: no surviving prior owner. Spin the sector out to a fresh private
      // corp via the normal privatization path. Clear the absorb stamp first so the
      // re-privatization cooldown does not reject a court-ordered return.
      await sectorsCol.updateOne(
        { _id: sector._id },
        { $unset: { absorbedAtTurn: "", nationalizationProvenance: "" }, $set: { updatedAt: now } }
      );
      const carveName = `${params.label} Returned ${sector._id.toString().slice(-6)}`.slice(0, 60);
      await privatizeAsset(db, {
        countryId: params.countryId as CountryId,
        sourceNationalCorporationId: holder._id,
        selections: [{ sectorId: sector._id, carveFraction: 1 }],
        newCorpName: carveName,
        goldenSharePercent: 0,
        method: "ipo",
        turn: params.turn,
      });
      spunOut++;
    } catch (err) {
      console.error(
        `[reverseNationalization] failed to return sector ${sectorId.toString()}:`,
        err
      );
      skipped++;
    }
  }

  return { restoredToPriorOwner, spunOut, skipped };
}
