/**
 * Corporation-held share cleanup (corporation exit). Cross-corporation equity
 * still held by an exiting corporation returns to each issuer's public float:
 * see releaseCorporationHeldSharesToFloat. Unrelated holders are untouched.
 */
import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { casReleaseIssuerFloat } from "./releaseSharesConservation";

export interface ReleaseCorporationHeldSharesResult {
  /** Total shares credited to issuers' public floats. */
  sharesReleased: number;
  /** Number of issuer corporations cleared of the holder's positions. */
  corpsShareholderCleared: number;
}

/**
 * When a corporation exits the game, any cross-corporation equity positions it
 * still holds should be stripped from shareholder ledgers and returned to each
 * issuer's public float. We do this before deleting the holder corp so no
 * surviving corporation retains an orphaned `shareholders.corporationId`.
 *
 * Counts: `sharesReleased` is the total shares credited to public floats,
 * summing every duplicate row for the holder. `corpsShareholderCleared`
 * counts issuer corporations cleared (one per issuer), not array entries.
 * An issuer whose matching rows total zero shares is left untouched (no
 * write, no counts), preserving prior behavior.
 *
 * Conservation: each issuer is updated by one `$set` write that removes every
 * matching row and credits the sum of all of them, guarded by a
 * compare-and-swap on the full shareholder snapshot plus the snapshot float
 * (see casReleaseIssuerFloat). A concurrent change to the issuer retries from
 * a fresh exact read, up to a bounded attempt budget; past that budget, on
 * malformed affected-row or float data, or on an ambiguous (unacknowledged)
 * write, this throws and the caller must NOT delete the holder. A conflict
 * that exhausts the budget may leave earlier issuers in this run already
 * credited, so the error never claims nothing was written: retry the cleanup
 * (which reconciles) instead of deleting the holder. A row keyed only by
 * another holder kind (`characterId`, `imperialCharacterId`, `fundId`,
 * `nppId`) is ignored; an affected row carrying any additional holder key
 * fails closed as ambiguous. This alone does not fence trades that land
 * after the release: a position opened between this cleanup and the holder's
 * deletion needs its own guard at the deletion site.
 */
export async function releaseCorporationHeldSharesToFloat(
  db: Db,
  holderCorporationId: ObjectId,
  now: Date = new Date()
): Promise<ReleaseCorporationHeldSharesResult> {
  const corps = db.collection<Corporation>("corporations");

  const held = await corps
    .find(
      { "shareholders.corporationId": holderCorporationId },
      { projection: { _id: 1, shareholders: 1, publicFloat: 1 } }
    )
    .toArray();

  const wanted = new Set([holderCorporationId.toString()]);

  let sharesReleased = 0;
  let corpsShareholderCleared = 0;

  for (const issuer of held) {
    const outcome = await casReleaseIssuerFloat({
      corps,
      issuerId: issuer._id,
      snapshotHolders: issuer.shareholders ?? [],
      snapshotFloat: issuer.publicFloat,
      key: "corporationId",
      wanted,
      now,
    });
    sharesReleased += outcome.shares;
    if (outcome.rows > 0) corpsShareholderCleared += 1;
  }

  return { sharesReleased, corpsShareholderCleared };
}
