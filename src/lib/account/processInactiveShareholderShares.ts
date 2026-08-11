import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation, User } from "@/lib/db/types";
import { cleanupShareMarketActivityForCharacters } from "@/lib/corporations/cleanupShareMarketActivity";
import { releaseCharacterHeldSharesToFloat } from "@/lib/corporations/releaseCharacterHeldSharesToFloat";
import { isUserActive, INACTIVE_SHAREHOLDER_TURN_THRESHOLD } from "@/lib/players/playerActivity";

export interface ProcessInactiveShareholderSharesOptions {
  now: Date;
  forexEnabled: boolean;
}

export interface ProcessInactiveShareholderSharesResult {
  usersProcessed: number;
  charactersProcessed: number;
  sharesReleasedToFloat: number;
  sharePositionsReleased: number;
  ordersCancelled: number;
  listingsCancelled: number;
  offersCancelled: number;
}

function emptyResult(): ProcessInactiveShareholderSharesResult {
  return {
    usersProcessed: 0,
    charactersProcessed: 0,
    sharesReleasedToFloat: 0,
    sharePositionsReleased: 0,
    ordersCancelled: 0,
    listingsCancelled: 0,
    offersCancelled: 0,
  };
}

/**
 * Return every share position held by a user inactive for at least
 * INACTIVE_SHAREHOLDER_TURN_THRESHOLD turns to each issuer's public float, for no
 * compensation — EXCEPT positions in corporations the user owns / is CEO of.
 * Also cancels the user's dangling market activity for the swept (non-exempt)
 * corps, refunding escrow. The CEO seat is never vacated; returning users are not
 * compensated and shares are not restored.
 *
 * Holdings-first: a single scan of corps that have character shareholders gates
 * everything, so dormant accounts that hold nothing are never examined. Naturally
 * idempotent — after the first sweep an inactive user has no non-exempt holdings,
 * so later turns perform no writes.
 */
export async function processInactiveShareholderShares(
  db: Db,
  options: ProcessInactiveShareholderSharesOptions
): Promise<ProcessInactiveShareholderSharesResult> {
  const { now, forexEnabled } = options;

  // 1. Scan corps that have at least one character shareholder.
  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      { "shareholders.characterId": { $exists: true } },
      { projection: { _id: 1, ceoId: 1, userId: 1, shareholders: 1 } }
    )
    .toArray();
  if (corps.length === 0) return emptyResult();

  // 2. Collect distinct holder characterIds (positions with shares > 0).
  const holderCharIdSet = new Set<string>();
  for (const corp of corps) {
    for (const sh of corp.shareholders ?? []) {
      if (sh.characterId && (sh.shares ?? 0) > 0) {
        holderCharIdSet.add(sh.characterId.toString());
      }
    }
  }
  if (holderCharIdSet.size === 0) return emptyResult();
  const holderCharIds = [...holderCharIdSet].map((id) => new ObjectId(id));

  // 3. Map character -> user.
  const chars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: holderCharIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();
  const charIdsByUser = new Map<string, ObjectId[]>();
  for (const c of chars) {
    if (!c.userId) continue;
    const key = c.userId.toString();
    const list = charIdsByUser.get(key) ?? [];
    list.push(c._id);
    charIdsByUser.set(key, list);
  }
  if (charIdsByUser.size === 0) return emptyResult();

  // 4. Keep only inactive holder users.
  const holderUserIds = [...charIdsByUser.keys()].map((id) => new ObjectId(id));
  const users = await db
    .collection<User>("users")
    .find(
      { _id: { $in: holderUserIds } },
      { projection: { _id: 1, lastActivity: 1, createdAt: 1 } }
    )
    .toArray();
  const inactiveUserIds: string[] = [];
  for (const u of users) {
    if (!isUserActive(u.lastActivity, u.createdAt, now, INACTIVE_SHAREHOLDER_TURN_THRESHOLD)) {
      inactiveUserIds.push(u._id.toString());
    }
  }
  if (inactiveUserIds.length === 0) return emptyResult();

  // 5. Per inactive holder user: compute exempt corps, skip CEO-only holders,
  //    then cleanup market activity + release shares (both excluding exempt corps).
  const result = emptyResult();

  for (const userIdStr of inactiveUserIds) {
    const characterIds = charIdsByUser.get(userIdStr) ?? [];
    if (characterIds.length === 0) continue;
    const charIdStrs = new Set(characterIds.map((id) => id.toString()));

    // Exempt corps: the user owns the corp (corp.userId === U) or sits as its CEO
    // (corp.ceoId is one of their characters). hasNonExemptHolding gates work so a
    // CEO-only holder is skipped entirely (keeps the sweep idempotent + cheap).
    const exemptCorpIds: ObjectId[] = [];
    let hasNonExemptHolding = false;
    for (const corp of corps) {
      const ownedByUser = corp.userId?.toString() === userIdStr;
      const ceoByUser = corp.ceoId ? charIdStrs.has(corp.ceoId.toString()) : false;
      if (ownedByUser || ceoByUser) {
        exemptCorpIds.push(corp._id);
        continue;
      }
      if (!hasNonExemptHolding) {
        for (const sh of corp.shareholders ?? []) {
          if (sh.characterId && charIdStrs.has(sh.characterId.toString()) && (sh.shares ?? 0) > 0) {
            hasNonExemptHolding = true;
            break;
          }
        }
      }
    }
    if (!hasNonExemptHolding) continue;

    const cleanup = await cleanupShareMarketActivityForCharacters(
      db,
      characterIds,
      now,
      forexEnabled,
      { excludeCorporationIds: exemptCorpIds }
    );
    const released = await releaseCharacterHeldSharesToFloat(db, characterIds, now, {
      excludeCorporationIds: exemptCorpIds,
    });

    result.usersProcessed += 1;
    result.charactersProcessed += characterIds.length;
    result.sharesReleasedToFloat += released.sharesReleased;
    result.sharePositionsReleased += released.positionsReleased;
    result.ordersCancelled += cleanup.ordersCancelled;
    result.listingsCancelled += cleanup.listingsCancelled;
    result.offersCancelled += cleanup.offersCancelled;
  }

  return result;
}
