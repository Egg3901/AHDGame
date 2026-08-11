/**
 * Global Alert — page-wide dismissible notifications for events that warrant
 * cross-page visibility (e.g. mass-cascade sovereign-default events).
 *
 * Each alert has a kind (currently only "mass-cascade", more may follow),
 * a per-event payload, an expiration time, and a per-user dismissal list so
 * each user can dismiss independently. The active-alerts API filters by
 * `expiresAtRealtimeMs > now AND user not in dismissedByUserIds`.
 */
import type { ObjectId } from "mongodb";

export interface GlobalAlert {
  _id: ObjectId;
  kind: "mass-cascade";
  countryCode: string;
  insolventCorpCount: number;
  emittedAtTurn: number;
  emittedAtRealtimeMs: number;
  expiresAtRealtimeMs: number;
  dismissedByUserIds: ObjectId[];
}
