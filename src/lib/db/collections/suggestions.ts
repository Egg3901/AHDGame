import type { Db } from "mongodb";
import type { Suggestion } from "../types/suggestion";

export function getSuggestionsCollection(db: Db) {
  return db.collection<Suggestion>("suggestions");
}
