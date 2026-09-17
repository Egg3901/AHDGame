/**
 * Character-held share cleanup (account and character exit). Shares held
 * directly by exiting characters return to each issuer's public float: see
 * releaseCharacterHeldSharesToFloat. Unrelated holders are untouched.
 */
import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { casReleaseIssuerFloat } from "./releaseSharesConservation";

export interface ReleaseCharacterHeldSharesResult {
  /** Total shares credited to issuers' public floats. */
  sharesReleased: number;
  /** Total shareholder array entries removed across all issuers. */
  positionsReleased: number;
}

/**
 * Remove direct personal shareholder rows before a character exits the game so
 * issuer ledgers do not retain orphaned `characterId` references.
 *
 * `opts.excludeCorporationIds` keeps the listed issuers' positions untouched,
 * used by the inactive-user sweep to spare corps the holder owns / is CEO of.
 *
 * Counts: `sharesReleased` is the total shares credited to public floats.
 * `positionsReleased` counts removed shareholder array entries (positions),
 * not issuers: duplicate rows for one holder each count. Duplicate ids in
 * `characterIds` are deduplicated, so they never overcount. An issuer whose
 * matching rows total zero shares is left untouched (no write, no counts),
 * preserving prior behavior; zero-share rows removed alongside credited rows
 * are scrubbed without credit.
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
 * another holder kind (`corporationId`, `imperialCharacterId`, `fundId`,
 * `nppId`) is ignored; an affected row carrying any additional holder key
 * fails closed as ambiguous. This alone does not fence trades that land
 * after the release: a position opened between this cleanup and the holder's
 * deletion needs its own guard at the deletion site.
 */
export async function releaseCharacterHeldSharesToFloat(
  db: Db,
  characterIds: ObjectId[],
  now: Date = new Date(),
  opts?: { excludeCorporationIds?: ObjectId[] }
): Promise<ReleaseCharacterHeldSharesResult> {
  if (characterIds.length === 0) {
    return { sharesReleased: 0, positionsReleased: 0 };
  }

  const uniqueByString = new Map<string, ObjectId>();
  for (const id of characterIds) {
    if (!uniqueByString.has(id.toString())) uniqueByString.set(id.toString(), id);
  }
  const uniqueIds = [...uniqueByString.values()];
  const charIdSet = new Set(uniqueByString.keys());

  const exclude = opts?.excludeCorporationIds ?? [];
  const excludeSet = new Set(exclude.map((id) => id.toString()));

  const corps = db.collection<Corporation>("corporations");

  const query: { "shareholders.characterId": { $in: ObjectId[] }; _id?: { $nin: ObjectId[] } } = {
    "shareholders.characterId": { $in: uniqueIds },
  };
  if (exclude.length > 0) {
    query._id = { $nin: exclude };
  }

  const issuers = await corps
    .find(query, { projection: { _id: 1, shareholders: 1, publicFloat: 1 } })
    .toArray();

  let sharesReleased = 0;
  let positionsReleased = 0;

  for (const issuer of issuers) {
    if (excludeSet.has(issuer._id.toString())) continue;
    const outcome = await casReleaseIssuerFloat({
      corps,
      issuerId: issuer._id,
      snapshotHolders: issuer.shareholders ?? [],
      snapshotFloat: issuer.publicFloat,
      key: "characterId",
      wanted: charIdSet,
      now,
    });
    sharesReleased += outcome.shares;
    positionsReleased += outcome.rows;
  }

  return { sharesReleased, positionsReleased };
}
