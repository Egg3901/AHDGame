import type { ObjectId } from "mongodb";

/**
 * Support ticket — opened ONLY via the Discord bot `/ticket` flow (see plan:
 * tickets are Discord-only). Bug reports submitted from the website use the
 * separate `feedback` collection and are NOT part of this triage pipeline.
 */

/** High-level ticket topic (mirrors the bot's ticket panel categories). */
export type TicketCategory = "bug" | "moderation" | "account" | "gameplay" | "other";

export type TicketStatus =
  | "open" // just created; within the review-hold window
  | "triaging" // picked up by the read-only audit worker
  | "assessed" // audit complete, assessment attached
  | "in_progress" // a fix session was launched
  | "resolved"
  | "closed"
  | "wont_fix";

/**
 * One captured Discord message in the ticket thread. We snapshot the original
 * opening message plus any follow-ups (and their image attachments) so the
 * audit has the full context even after the Discord channel is archived.
 */
export interface TicketMessage {
  /** Discord message id (for dedupe when the bot mirrors edits/follow-ups). */
  discordMessageId?: string;
  /** Discord user id of the author. */
  authorId?: string;
  /** Display name at capture time. */
  authorName?: string;
  content: string;
  /** Image/attachment URLs on this message. */
  imageUrls?: string[];
  createdAt: Date;
}

export interface Ticket {
  _id: ObjectId;
  /** Display id #1, #2 — independent counter (`counters._id = "tickets"`). */
  ticketNumber: number;
  /** Discord-only intake per design decision D4. */
  source: "discord";
  /** Ticket channel id the bot opened for this report. */
  discordChannelId?: string;
  /** Discord user id of the opener. */
  discordUserId?: string;
  /** Discord username/handle at submit time. */
  discordUsername?: string;
  /** Discord global display name at submit time. */
  discordDisplayName?: string;
  /** Linked game account, if the opener has one. */
  userId?: ObjectId | null;
  /**
   * Game-side context resolved at open time when the Discord user has a linked
   * account — surfaced in the mgmt UI so admins can jump to who reported it.
   * Omitted entirely for unlinked Discord users.
   */
  reporter?: {
    username?: string;
    characterName?: string;
    /** Absolute URL to the reporter's character profile page. */
    profileUrl?: string;
    corporationName?: string;
    corporationTicker?: string;
    /** Absolute URL to the reporter's corporation page (if they own one). */
    corporationUrl?: string;
  };
  category: TicketCategory;
  title: string;
  /** Optional free-form tags for grouping/filtering. */
  tags?: string[];
  /**
   * Append-only audit trail of status transitions. Each entry records the new
   * status, when it happened, who/what triggered it, and an optional note.
   */
  statusHistory?: Array<{
    status: string;
    at: Date;
    by?: string;
    source: "triage" | "ops" | "bot" | "system";
    note?: string;
  }>;
  /**
   * Resolution message surfaced back to the reporter when a ticket is closed.
   * `deliveredAt` is null until the bot delivers it to the Discord user.
   */
  resolution?: {
    message: string;
    createdAt: Date;
    closedBy?: string;
    deliveredAt: Date | null;
  };
  /** The opening message body. */
  description: string;
  /** Original opening message + captured follow-ups (with images). */
  messages: TicketMessage[];
  /** Flattened list of all attached image URLs, for quick rendering. */
  imageUrls: string[];
  status: TicketStatus;
  /**
   * The audit worker must not review the ticket until this time — bug reports
   * often need the user to attach screenshots/repro after opening, so we hold
   * for a window (default 15 min) to capture follow-ups first.
   */
  reviewAfter: Date;
  /** Read-only audit linkage (see `assessments` collection). */
  assessmentId?: ObjectId;
  assessedAt?: Date;
  /** Set when an admin clicks "Launch" — links to the `fix_sessions` doc. */
  fixSessionId?: ObjectId;
  githubIssueUrl?: string;
  githubIssueNumber?: number;
  adminNotes?: string;
  closedAt?: Date;
  /** Discord id or admin email that closed it. */
  closedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}
