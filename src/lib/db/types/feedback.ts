import type { ObjectId } from "mongodb";
import type { SuggestionCategory } from "./suggestion";

export type FeedbackType = "bug" | "suggestion";

export type BugCategory =
  | "ui_ux"
  | "performance"
  | "data_display"
  | "authentication"
  | "elections"
  | "congress_bills"
  | "parties"
  | "npps"
  | "map"
  | "actions"
  | "notifications"
  | "other";

export interface FeedbackContext {
  pathname: string;
  url: string;
  capturedAt: string;
  lastAction?: { label: string; timestamp: string; metadata?: Record<string, unknown> };
  recentActions: Array<{ label: string; timestamp: string; metadata?: Record<string, unknown> }>;
  userAgent: string;
  viewport: { width: number; height: number };
  referrer?: string;
}

export type FeedbackStatus = "open" | "in_progress" | "resolved" | "wont_fix";

/** GlitchTip/Sentry event ID associated with this feedback, if any. Links the
 * player's bug report directly to the captured exception in GlitchTip for
 * instant stack-trace lookup. */
export interface Feedback {
  _id: ObjectId;
  issueNumber: number;
  userId: ObjectId | null;
  type: FeedbackType;
  category: BugCategory | SuggestionCategory;
  title: string;
  description: string;
  stepsToReproduce?: string;
  severity?: number;
  impact?: string;
  priority?: number;
  context: FeedbackContext;
  metadata?: Record<string, unknown>;
  /** Sentry/GlitchTip event UUID — links this feedback to a captured exception. */
  sentryEventId?: string;
  status: FeedbackStatus;
  adminNotes?: string;
  statusChangedAt?: Date;
  statusChangedBy?: ObjectId;
  githubIssueUrl?: string;
  githubIssueNumber?: number;
  screenshotUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}
