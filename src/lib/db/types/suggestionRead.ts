import type { ObjectId } from "mongodb";

/** Per-user read cursor for suggestion threads (`suggestionReads` collection). */
export interface SuggestionRead {
  _id: ObjectId;
  userId: ObjectId;
  suggestionId: ObjectId;
  lastReadAt: Date;
}
