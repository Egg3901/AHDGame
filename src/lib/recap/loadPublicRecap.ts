import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import type { CharacterRecap } from "./types";

/**
 * The newest frozen recap for a characterId, for the public share surfaces
 * (`/wrapped/[characterId]`, its OG card and story image). No auth or ownership
 * check by design: a shared link must open for anyone. Returns null on a bad id
 * or a database error so an unfurl renders the generic card instead of a 500.
 */
export async function loadPublicRecap(characterId: string): Promise<CharacterRecap | null> {
  try {
    if (!ObjectId.isValid(characterId)) return null;
    const db = await getDb();
    const doc = await db
      .collection<RetiredCharacter>("retiredCharacters")
      .findOne(
        { characterId: new ObjectId(characterId), recap: { $exists: true } },
        { sort: { retiredAt: -1 }, projection: { recap: 1 } }
      );
    return doc?.recap ?? null;
  } catch {
    return null;
  }
}
