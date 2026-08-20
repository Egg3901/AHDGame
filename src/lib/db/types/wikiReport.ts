import type { ObjectId } from "mongodb";

export const WIKI_REPORT_REASONS = ["stale", "incorrect", "update-request", "other"] as const;

export type WikiReportReason = (typeof WIKI_REPORT_REASONS)[number];

/** Player-submitted issue against a wiki page. Stored in `wikiReports`. */
export interface WikiReport {
  _id: ObjectId;
  slug: string;
  reason: WikiReportReason;
  note: string;
  ip: string;
  userId?: ObjectId;
  createdAt: Date;
  /** True when the optional WIKI_REPORT_ENDPOINT relay was attempted. */
  relayAttempted: boolean;
}
