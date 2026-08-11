import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export type BillDiscussionScopeKind = "national" | "state";

export interface BillDiscussionModeration {
  hidden: true;
  hiddenBy: ObjectId;
  hiddenAt: Date;
}

/**
 * One discussion post on a bill. `billScope` disambiguates `billId` between the
 * `bills` (national) and `stateBills` (state) collections. Author identity is
 * denormalized at post time — a snapshot of who the author was when they posted.
 */
export interface BillDiscussion {
  _id: ObjectId;
  billScope: BillDiscussionScopeKind;
  billId: ObjectId;
  countryId: CountryId;
  /** Uppercase region code; present only for `state` scope. */
  stateId?: string;
  authorId: ObjectId;
  authorUserId: ObjectId;
  authorName: string;
  authorAvatarUrl: string | null;
  authorSequentialId: number | null;
  authorParty: string | null;
  authorPartyColor: string | null;
  authorRegionLabel: string | null;
  content: string;
  reactions: { agree: number; disagree: number };
  /** Absent = visible. Set by admin soft-hide. */
  moderation?: BillDiscussionModeration;
  createdAt: Date;
}

/** One reaction by one user on one post. Unique on (discussionId, userId). */
export interface BillDiscussionReaction {
  _id: ObjectId;
  discussionId: ObjectId;
  userId: ObjectId;
  reaction: "agree" | "disagree";
  createdAt: Date;
}
