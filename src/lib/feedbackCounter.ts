import { getDb } from "@/lib/mongodb";

/**
 * Atomically get the next feedback issue number.
 * Uses a counters collection: { _id: "feedback", seq: N }
 * Syncs from max(issueNumber) in feedback if counter is missing or behind (handles legacy).
 */
export async function getNextFeedbackNumber(): Promise<number> {
  const db = await getDb();

  const maxDoc = await db
    .collection<{ issueNumber?: number }>("feedback")
    .findOne({ issueNumber: { $exists: true } }, { sort: { issueNumber: -1 } });
  const maxExisting = maxDoc?.issueNumber ?? 0;

  // Atomic: $max ensures we're at least maxExisting, then $inc gives next number
  const result = await db
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: "feedback" },
      [
        { $set: { seq: { $max: [{ $ifNull: ["$seq", 0] }, maxExisting] } } },
        { $set: { seq: { $add: ["$seq", 1] } } },
      ],
      { upsert: true, returnDocument: "after" }
    );

  return result?.seq ?? maxExisting + 1;
}
