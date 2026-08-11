import type { Db } from "mongodb";
import type { SuggestionComment } from "../types/suggestionComment";

export function getSuggestionCommentsCollection(db: Db) {
  return db.collection<SuggestionComment>("suggestionComments");
}
