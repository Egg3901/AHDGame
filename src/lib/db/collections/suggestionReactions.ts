import type { Db } from "mongodb";
import type { SuggestionReaction } from "../types/suggestion";

export function getSuggestionReactionsCollection(db: Db) {
  return db.collection<SuggestionReaction>("suggestionReactions");
}
