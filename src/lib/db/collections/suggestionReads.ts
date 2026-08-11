import type { Db } from "mongodb";
import type { SuggestionRead } from "../types/suggestionRead";

export function getSuggestionReadsCollection(db: Db) {
  return db.collection<SuggestionRead>("suggestionReads");
}
