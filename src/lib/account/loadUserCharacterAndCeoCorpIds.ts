import type { Db, ObjectId } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";

export interface UserCharacterAndCeoCorpIds {
  characterIds: ObjectId[];
  ceoCorpIds: ObjectId[];
}

export async function loadUserCharacterAndCeoCorpIds(
  db: Db,
  userId: ObjectId
): Promise<UserCharacterAndCeoCorpIds> {
  const characters = await db
    .collection<Character>("characters")
    .find({ userId }, { projection: { _id: 1 } })
    .toArray();
  const characterIds = characters.map((character) => character._id);

  if (characterIds.length === 0) {
    return { characterIds, ceoCorpIds: [] };
  }

  const ceoCorps = await db
    .collection<Corporation>("corporations")
    .find({ ceoId: { $in: characterIds } }, { projection: { _id: 1 } })
    .toArray();

  return {
    characterIds,
    ceoCorpIds: ceoCorps.map((corp) => corp._id),
  };
}
