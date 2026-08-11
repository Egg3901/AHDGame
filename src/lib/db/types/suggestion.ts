import type { ObjectId } from "mongodb";

/** Topic of the suggestion (high-level). */
export type SuggestionCategory =
  "feature_request" | "ui_improvement" | "game_balance" | "new_content" | "accessibility" | "other";

/** Which game area the suggestion targets (second-axis filter). */
export type SuggestionGameSystem =
  | "elections"
  | "legislature"
  | "executive"
  | "judiciary"
  | "economy"
  | "corporations"
  | "parties"
  | "npps"
  | "map_geo"
  | "combat_or_military"
  | "diplomacy"
  | "onboarding_account"
  | "notifications"
  | "meta_other";

export type SuggestionStatus =
  "not_reviewed" | "planned" | "in_progress" | "completed" | "not_implementing";

export interface SuggestionContext {
  pathname: string;
  url: string;
  capturedAt: string;
  lastAction?: { label: string; timestamp: string; metadata?: Record<string, unknown> };
  recentActions: Array<{ label: string; timestamp: string; metadata?: Record<string, unknown> }>;
  userAgent: string;
  viewport: { width: number; height: number };
  referrer?: string;
}

/** Player suggestion (forum) — stored in `suggestions` collection only. */
export interface Suggestion {
  _id: ObjectId;
  /** Display id #1, #2 — independent from legacy feedback issue numbers */
  issueNumber: number;
  userId: ObjectId | null;
  /**
   * When submitted via Discord bot (`/suggest`) without a linked game account, we still store
   * Discord identity for attribution (forum + webhook embeds). Omitted for normal web submissions.
   */
  discordSubmitUserId?: string;
  /** Discord username/handle (e.g. `foo` for @foo) from the bot at submit time */
  discordSubmitUsername?: string;
  /** Discord global display name from the bot at submit time */
  discordSubmitDisplayName?: string;
  category: SuggestionCategory;
  gameSystem: SuggestionGameSystem;
  title: string;
  description: string;
  impact?: string;
  priority?: number;
  commentCount: number;
  reactions?: {
    like: number;
    dislike: number;
  };
  context: SuggestionContext;
  metadata?: Record<string, unknown>;
  status: SuggestionStatus;
  adminNotes?: string;
  statusChangedAt?: Date;
  statusChangedBy?: ObjectId;
  githubIssueUrl?: string;
  githubIssueNumber?: number;
  screenshotUrl?: string;
  /** Set when this suggestion is merged into another */
  mergedInto?: ObjectId;
  /** IDs of suggestions merged INTO this one */
  mergedFrom?: ObjectId[];
  mergedAt?: Date;
  /** Set when a rich embed was successfully delivered to the suggestions Discord webhook */
  discordPostedAt?: Date;
  /** Discord message ID of the webhook post — used to match Discord reactions back to this suggestion */
  discordMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SuggestionReaction {
  _id: ObjectId;
  suggestionId: ObjectId;
  userId: ObjectId;
  reaction: "like" | "dislike";
  createdAt: Date;
}
