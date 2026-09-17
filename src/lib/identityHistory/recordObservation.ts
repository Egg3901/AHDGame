import type { Db, ObjectId } from "mongodb";
import {
  IDENTITY_OBSERVATIONS_COLLECTION,
  type IdentityObservation,
  type IdentityObservationSource,
  type IdentityTrack,
} from "@/lib/db/types/identityObservation";
import { isGroupableIdentityValue } from "./guards";

export interface RecordObservationInput {
  userId: ObjectId;
  track: IdentityTrack;
  value: string | null | undefined;
  observedAt: Date;
  source: IdentityObservationSource;
}

export type RecordObservationOutcome = "extended" | "opened" | "rejected" | "debounced";

/**
 * How close together two observations of the SAME value may be before the
 * second is dropped as a no-op.
 *
 * `/api/auth/record-fingerprint` is called from every authenticated page by the
 * session beacon, and `/api/auth/me` runs on every navigation. Without this,
 * a player reading ten pages writes ten updates that say nothing new, and
 * `observations` counts page views rather than distinct sightings. The debounce
 * costs one indexed lookup and skips the write, so a run's counter stays a
 * meaningful "how many separate times was this seen".
 */
export const IDENTITY_OBSERVATION_DEBOUNCE_MS = 60_000;

/**
 * Append an observation to the user's history for one track.
 *
 * Extends the CURRENTLY OPEN run (the one with the greatest `lastSeen`) when
 * the value matches, otherwise opens a new run. That is what makes a return to
 * an earlier value produce its own row rather than reviving the old one.
 */
export async function recordIdentityObservation(
  db: Db,
  { userId, track, value, observedAt, source }: RecordObservationInput
): Promise<RecordObservationOutcome> {
  if (!isGroupableIdentityValue(track, value)) return "rejected";
  const collection = db.collection<IdentityObservation>(IDENTITY_OBSERVATIONS_COLLECTION);

  const openRun = await collection.findOne({ userId, track }, { sort: { lastSeen: -1 } });

  if (openRun && openRun.value === value && openRun._id) {
    // A negative delta (clock skew, or an out-of-order fire-and-forget landing
    // late) also lands here, which is what we want: never move `lastSeen`
    // backwards, because it is the TTL anchor.
    if (observedAt.getTime() - openRun.lastSeen.getTime() < IDENTITY_OBSERVATION_DEBOUNCE_MS) {
      return "debounced";
    }
    await collection.updateOne(
      { _id: openRun._id },
      { $set: { lastSeen: observedAt }, $inc: { observations: 1 } }
    );
    return "extended";
  }

  await collection.insertOne({
    userId,
    track,
    value,
    firstSeen: observedAt,
    lastSeen: observedAt,
    observations: 1,
    source,
    datesKnown: true,
  });
  return "opened";
}

export interface RecordIdentitySignalsInput {
  userId: ObjectId;
  ip?: string | null;
  fingerprint?: string | null;
  observedAt: Date;
  source: IdentityObservationSource;
}

/**
 * Record both tracks for one observation event.
 *
 * Deliberately synchronous and returning void: identity history is evidence
 * collection, not part of any request's contract, so it must never be able to
 * delay or fail a login, a registration or a page load. Every rejection is
 * swallowed. Absent values are dropped by the guards inside
 * {@link recordIdentityObservation}, so callers pass what they have without
 * pre-checking.
 */
export function recordIdentitySignals(
  db: Db,
  { userId, ip, fingerprint, observedAt, source }: RecordIdentitySignalsInput
): void {
  void recordIdentityObservation(db, {
    userId,
    track: "ip",
    value: ip,
    observedAt,
    source,
  }).catch(() => {});
  void recordIdentityObservation(db, {
    userId,
    track: "fingerprint",
    value: fingerprint,
    observedAt,
    source,
  }).catch(() => {});
}
