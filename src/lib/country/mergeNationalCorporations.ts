/**
 * The absorbed country's National Corporation tree consolidates into the
 * survivor's.
 *
 * A country's state-enterprise layer is country-keyed (`countryOwnerId`), so the
 * region sweep in `transferRegion` never sees it: the absorbed state's PRIMARY
 * National Corporation and every split-off survive the merge as a second, ghost
 * NatCorp family — still flagged `isPrimaryNationalCorporation: true`, still
 * holding its sectors, still the `corporationId` on its sovereign bonds. The
 * live German reunification left exactly that: two primaries under the survivor,
 * merges and new nationalizations resolving "the primary" by insertion order
 * (the ghost), and coupon money flowing to a corp of a country that no longer
 * existed. This module is the missing consolidation step.
 *
 * THE SURVIVOR'S PRIMARY WINS. One country has exactly one primary (spec §24.1);
 * where both sides have one, the survivor's keeps the flag and the absorbed
 * side's is demoted and dissolved. Everything the absorbed tree owns folds into
 * it:
 *
 *  - SECTORS move to the survivor split-off that already claims the same sector
 *    type (keeping the one-NatCorp-per-type invariant), else to the survivor
 *    primary — the same per-type routing `resolveNationalCorporationForSector`
 *    applies to every future taking. The empty shells then dissolve.
 *  - SOVEREIGN BONDS re-stamp `corporationId` + `issuerName` onto the survivor
 *    primary — the same assumption-of-debt `mergeNationalFisc` performs on the
 *    country fields; without this the coupon cost keeps accruing to the ghost.
 *  - Corp-held stakes (privatization golden shares, cross-holdings) re-stamp to
 *    the survivor primary, so state-held positions survive the shell.
 *
 * IDEMPOTENT by filters: a re-run finds no corporations still keyed to the
 * absorbed country and writes nothing. Safe to place anywhere in the merge
 * pipeline; it runs after the regions have crossed so corps followed across by
 * `evacuateRegionPolitics` are already at rest.
 *
 * The absorbed shells are DELETED, not stamped-retired: a corporation has no
 * `dissolvedTurn` machinery (that is a country concept), and a flagged primary
 * left in place would keep answering "who is the primary" lookups. History that
 * needs the old ids keeps them in `nationalizationLedger` provenance and bond
 * `originalIssuerName`, same as the existing merge modules.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { ensurePrimaryNationalCorporation } from "@/lib/nationalization/nationalCorporation";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { cleanupShareMarketActivityForCorporations } from "@/lib/corporations/cleanupShareMarketActivity";
import { isForexEnabled } from "@/lib/currency/featureFlag";

export interface MergeNationalCorporationsArgs {
  fromCountryId: CountryId;
  toCountryId: CountryId;
}

export interface MergeNationalCorporationsResult {
  /** Absorbed NatCorp shells folded and deleted (the ghost primary included). */
  corpsDissolved: number;
  /** Producing sectors re-parented onto the survivor's NatCorp tree. */
  sectorsMoved: number;
  /** Sovereign bond issues re-stamped onto the survivor's primary. */
  bondsRestamped: number;
}

export async function mergeNationalCorporations(
  db: Db,
  args: MergeNationalCorporationsArgs
): Promise<MergeNationalCorporationsResult> {
  const { fromCountryId, toCountryId } = args;
  const now = new Date();
  const corps = db.collection<Corporation>("corporations");
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const bonds = db.collection("bonds");

  // The survivor's primary exists (or is created) FIRST, so there is always a
  // fold target even when the survivor had no NatCorp tree at all.
  const survivorPrimary = await ensurePrimaryNationalCorporation(db, toCountryId);

  const absorbedCorps = await corps.find({ countryOwnerId: fromCountryId }).toArray();
  if (absorbedCorps.length === 0) {
    return { corpsDissolved: 0, sectorsMoved: 0, bondsRestamped: 0 };
  }

  // The survivor split-off claiming each sector type, if any. A type both
  // sides split off folds into the SURVIVOR's enterprise of that type, so the
  // one-NatCorp-per-type invariant survives the merge (a sector joining a
  // split-off that already claims the type also merges into an existing
  // (corp, state, type) holding — the nationalization-absorb rule).
  const survivorSplitOffs = await corps
    .find({
      countryOwnerId: toCountryId,
      _id: { $ne: survivorPrimary._id },
      assignedSectorTypes: { $exists: true, $ne: [] },
    })
    .toArray();
  const claimedByType = new Map<string, ObjectId>();
  for (const corp of survivorSplitOffs) {
    for (const type of corp.assignedSectorTypes ?? []) {
      claimedByType.set(type, corp._id);
    }
  }

  let sectorsMoved = 0;
  const absorbedCorpIds: ObjectId[] = [];

  // Sectors first (they read the still-alive shells), then the shells.
  for (const corp of absorbedCorps) {
    absorbedCorpIds.push(corp._id);

    const corpSectors = await sectors.find({ corporationId: corp._id }).toArray();
    if (corpSectors.length === 0) continue;

    // Group by destination so each destination needs one update, not one per
    // sector — an absorbed command economy can carry hundreds of sectors.
    const byDest = new Map<string, ObjectId[]>();
    for (const sector of corpSectors) {
      const dest = claimedByType.get(sector.sectorType) ?? survivorPrimary._id;
      byDest.set(dest.toString(), [...(byDest.get(dest.toString()) ?? []), sector._id]);
    }
    for (const [destId, sectorIds] of byDest) {
      const res = await sectors.updateMany(
        { _id: { $in: sectorIds } },
        { $set: { corporationId: new ObjectId(destId), updatedAt: now } }
      );
      sectorsMoved += res.modifiedCount ?? 0;
    }
  }

  // Sovereign bonds the absorbed state issued: the survivor primary assumes
  // them. `mergeNationalFisc` rescopes the same bonds' COUNTRY fields; this is
  // the corp half of the same assumption, without which coupons keep flowing
  // to a corp of a country that no longer exists. `originalIssuerName` keeps
  // the absorbed side's name as provenance (only when not already stamped, so
  // a re-run never overwrites the real provenance with the survivor's name).
  const absorbedBonds = await bonds
    .find({ issuerType: "sovereign", corporationId: { $in: absorbedCorpIds }, matured: false })
    .toArray();
  if (absorbedBonds.length > 0) {
    await bonds.bulkWrite(
      absorbedBonds.map((bond) => ({
        updateOne: {
          filter: { _id: bond._id },
          update: {
            $set: {
              corporationId: survivorPrimary._id,
              issuerName: survivorPrimary.name,
              ...(bond.originalIssuerName ? {} : { originalIssuerName: bond.issuerName }),
              updatedAt: now,
            },
          },
        },
      }))
    );
  }

  // Corp-held stakes in other corporations (privatization golden shares, any
  // cross-holding) re-stamp to the survivor primary — the same assumption
  // `transferOwnedSharesToNatCorp` performs on a single-corp nationalization.
  // One pass per held stake, not per corp, is fine at merge scale.
  for (const corpId of absorbedCorpIds) {
    await corps.updateMany(
      { "shareholders.corporationId": corpId },
      {
        $set: { "shareholders.$[elem].corporationId": survivorPrimary._id, updatedAt: now },
      },
      { arrayFilters: [{ "elem.corporationId": corpId }] }
    );
  }

  // Dissolve the absorbed shells LAST. The ghost primary loses its flag here —
  // deleting a document whose only readers filtered on `countryOwnerId` makes
  // every future lookup (primary, split-off, per-type routing) land on the
  // survivor's tree by construction. The two bookkeeping stamps mirror the
  // single-corp nationalization path: share-market activity is unwound first
  // (NatCorps never float, so this is belt-and-braces for any stray order), and
  // the tx log keeps its forensic trail with the deletion time pinned.
  const forexEnabled = await isForexEnabled();
  for (const corp of absorbedCorps) {
    await cleanupShareMarketActivityForCorporations(db, [corp._id], now, forexEnabled);
    await stampSubjectDeleted(db, corp._id, {
      sequentialId: corp.sequentialId,
      deletedAt: now,
    });
    await corps.deleteOne({ _id: corp._id });
  }

  return {
    corpsDissolved: absorbedCorps.length,
    sectorsMoved,
    bondsRestamped: absorbedBonds.length,
  };
}
