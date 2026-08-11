import type { ObjectId } from "mongodb";

export interface PartyDiscussionPost {
  _id: ObjectId;
  partyId: string;
  countryId: string;
  /** "national" for national party page, "state" for state party page */
  scope: "national" | "state";
  /** Required when scope === "state" */
  regionId?: string;
  authorCharacterId: ObjectId;
  authorName: string;
  content: string;
  createdAt: Date;
  deletedAt?: Date;
  deletedBy?: ObjectId;
}
