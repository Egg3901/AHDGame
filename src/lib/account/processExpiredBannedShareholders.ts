import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation, User } from "@/lib/db/types";
import {
  cleanupShareMarketActivityForCharacters,
  cleanupShareMarketActivityForCorporations,
} from "@/lib/corporations/cleanupShareMarketActivity";
import { releaseCharacterHeldSharesToFloat } from "@/lib/corporations/releaseCharacterHeldSharesToFloat";
import { releaseCorporationHeldSharesToFloat } from "@/lib/corporations/releaseHeldSharesToFloat";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";

export const BANNED_SHARE_RELEASE_GRACE_MS = 48 * 60 * 60 * 1000;

export interface ProcessExpiredBannedShareholdersOptions {
  now: Date;
  currentTurn: number;
  forexEnabled: boolean;
}

export interface ProcessExpiredBannedShareholdersResult {
  usersProcessed: number;
  charactersProcessed: number;
  sharesReleasedToFloat: number;
  characterSharePositionsReleased: number;
  corporationSharePositionsReleased: number;
  ceoCorpsVacated: number;
  pendingCeoOffersCleared: number;
  ordersCancelled: number;
  listingsCancelled: number;
  offersCancelled: number;
}

export async function processExpiredBannedShareholders(
  db: Db,
  options: ProcessExpiredBannedShareholdersOptions
): Promise<ProcessExpiredBannedShareholdersResult> {
  const { now, currentTurn, forexEnabled } = options;
  const cutoff = new Date(now.getTime() - BANNED_SHARE_RELEASE_GRACE_MS);

  const expiredBannedUsers = await db
    .collection<User>("users")
    .find(
      {
        isBanned: true,
        bannedAt: { $type: "date", $lte: cutoff },
        bannedShareReleaseProcessedAt: { $exists: false },
      },
      { projection: { _id: 1, bannedShareReleaseCorporationIds: 1 } }
    )
    .toArray();

  if (expiredBannedUsers.length === 0) {
    return {
      usersProcessed: 0,
      charactersProcessed: 0,
      sharesReleasedToFloat: 0,
      characterSharePositionsReleased: 0,
      corporationSharePositionsReleased: 0,
      ceoCorpsVacated: 0,
      pendingCeoOffersCleared: 0,
      ordersCancelled: 0,
      listingsCancelled: 0,
      offersCancelled: 0,
    };
  }

  const userIds = expiredBannedUsers.map((user) => user._id);
  const characters = await db
    .collection<Character>("characters")
    .find({ userId: { $in: userIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();

  const charIdsByUser = new Map<string, ObjectId[]>();
  for (const userId of userIds) {
    charIdsByUser.set(userId.toString(), []);
  }
  for (const character of characters) {
    const key = character.userId.toString();
    const existing = charIdsByUser.get(key) ?? [];
    existing.push(character._id);
    charIdsByUser.set(key, existing);
  }

  let charactersProcessed = 0;
  let sharesReleasedToFloat = 0;
  let characterSharePositionsReleased = 0;
  let corporationSharePositionsReleased = 0;
  let ceoCorpsVacated = 0;
  let pendingCeoOffersCleared = 0;
  let ordersCancelled = 0;
  let listingsCancelled = 0;
  let offersCancelled = 0;

  for (const user of expiredBannedUsers) {
    const characterIds = charIdsByUser.get(user._id.toString()) ?? [];
    charactersProcessed += characterIds.length;

    const ceoCorps = characterIds.length
      ? await db
          .collection<Corporation>("corporations")
          .find({ ceoId: { $in: characterIds } }, { projection: { _id: 1, ceoId: 1 } })
          .toArray()
      : [];
    const ceoCorpIds = [
      ...new Set(
        [
          ...ceoCorps.map((corp) => corp._id.toString()),
          ...((user.bannedShareReleaseCorporationIds ?? []).map((id) => id.toString()) ?? []),
        ].filter(Boolean)
      ),
    ].map((id) => new ObjectId(id));

    const characterMarketCleanup = await cleanupShareMarketActivityForCharacters(
      db,
      characterIds,
      now,
      forexEnabled
    );
    ordersCancelled += characterMarketCleanup.ordersCancelled;
    listingsCancelled += characterMarketCleanup.listingsCancelled;
    offersCancelled += characterMarketCleanup.offersCancelled;

    const corporationMarketCleanup = await cleanupShareMarketActivityForCorporations(
      db,
      ceoCorpIds,
      now,
      forexEnabled
    );
    ordersCancelled += corporationMarketCleanup.ordersCancelled;
    listingsCancelled += corporationMarketCleanup.listingsCancelled;
    offersCancelled += corporationMarketCleanup.offersCancelled;

    const releasedCharacterHoldings = await releaseCharacterHeldSharesToFloat(
      db,
      characterIds,
      now
    );
    sharesReleasedToFloat += releasedCharacterHoldings.sharesReleased;
    characterSharePositionsReleased += releasedCharacterHoldings.positionsReleased;

    for (const corporationId of ceoCorpIds) {
      const releasedCorpHoldings = await releaseCorporationHeldSharesToFloat(
        db,
        corporationId,
        now
      );
      sharesReleasedToFloat += releasedCorpHoldings.sharesReleased;
      corporationSharePositionsReleased += releasedCorpHoldings.corpsShareholderCleared;
    }

    if (characterIds.length > 0) {
      const ceoVacateRes = await db.collection<Corporation>("corporations").updateMany(
        { ceoId: { $in: characterIds }, ceoVacant: { $ne: true } },
        {
          $set: {
            ceoVacant: true,
            ceoVacantSinceTurn: currentTurn,
            updatedAt: now,
          },
          $unset: { ceoId: "", userId: "" },
        }
      );
      ceoCorpsVacated += ceoVacateRes.modifiedCount ?? 0;

      for (const corp of ceoCorps) {
        if (corp.ceoId) {
          await closeCeoTenure(db, corp._id, { holderId: corp.ceoId, turn: currentTurn });
        }
      }

      const pendingRes = await db
        .collection<Corporation>("corporations")
        .updateMany(
          { pendingCeoCharacterId: { $in: characterIds } },
          { $unset: { pendingCeoCharacterId: "" }, $set: { updatedAt: now } }
        );
      pendingCeoOffersCleared += pendingRes.modifiedCount ?? 0;
    }

    await db.collection<User>("users").updateOne(
      { _id: user._id, isBanned: true },
      {
        $set: { bannedShareReleaseProcessedAt: now, updatedAt: now },
        $unset: { bannedShareReleaseCorporationIds: "" },
      }
    );
  }

  return {
    usersProcessed: expiredBannedUsers.length,
    charactersProcessed,
    sharesReleasedToFloat,
    characterSharePositionsReleased,
    corporationSharePositionsReleased,
    ceoCorpsVacated,
    pendingCeoOffersCleared,
    ordersCancelled,
    listingsCancelled,
    offersCancelled,
  };
}
