import type { ObjectId } from "mongodb";

/** Comment on a player suggestion (`suggestions` collection). */
export interface SuggestionComment {
  _id: ObjectId;
  suggestionId: ObjectId;
  userId: ObjectId;
  characterId: ObjectId;
  authorName: string;
  authorAvatarUrl?: string | null;
  authorParty?: string | null;
  body: string;
  createdAt: Date;
}
