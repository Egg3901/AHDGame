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

export type RecordObservationOutcome = "extended" | "opened" | "rejected";

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
