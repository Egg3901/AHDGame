import type { ObjectId } from "mongodb";

export type NewsCategory =
  | "election"
  | "legislation"
  | "executive"
  | "general"
  | "sovereign"
  /** SCOTUS Docket case rulings (curated landmark cases + surprise cases) — see `src/lib/scotus/scotusNews.ts`. */
  | "judicial";

/** Player-authored top-level posts: free journalism vs paid placement. Omitted/legacy = article. */
export type NewsFeedType = "article" | "advertisement";

/** Moderation lifecycle. Absent/legacy = "visible". */
export type NewsModerationStatus = "visible" | "hidden" | "removed";

export interface NewsModeration {
  status: NewsModerationStatus;
  /** Set when status transitions away from "visible". */
  actionedAt?: Date;
  /** Admin userId (as ObjectId) that set the current status. */
  actionedBy?: ObjectId;
  /** Short internal note / policy category. */
  reason?: string;
}

export interface NewsPost {
  _id: ObjectId;
  stateId?: string;
  parentId?: ObjectId;
  authorId: ObjectId;
  authorName: string;
  authorAvatarUrl?: string;
  authorParty?: string;
  title?: string;
  content: string;
  /** Optional hero image (Vercel Blob or local dev upload URL). Player posts only. */
  imageUrl?: string;
  /** Player posts only — `advertisement` uses AP/CF; `article` is free with a longer cooldown. */
  feedType?: NewsFeedType;
  /** True for automated system-generated news (election results, bill signings, etc.) */
  isSystem?: boolean;
  /** Category for system news to enable filtering */
  category?: NewsCategory;
  /** Absent = visible. Non-visible posts are filtered from public reads. */
  moderation?: NewsModeration;
  /** Lifetime reports received. Auto-incremented by POST /api/news/[id]/report. */
  reportCount?: number;
  reactions: {
    agree: number;
    disagree: number;
  };
  replyCount: number;
  /** Discord message ID of the webhook post — used to match Discord reactions back to this post */
  discordMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
  /** Set when the author edits a top-level post after publishing. Drives the "(edited)" marker. */
  editedAt?: Date;
}

export interface NewsReaction {
  _id: ObjectId;
  postId: ObjectId;
  userId: ObjectId;
  reaction: "agree" | "disagree";
  createdAt: Date;
}
