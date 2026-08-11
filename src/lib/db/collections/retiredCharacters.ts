import type { Db } from "mongodb";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";

export function getRetiredCharactersCollection(db: Db) {
  return db.collection<RetiredCharacter>("retiredCharacters");
}
