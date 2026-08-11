import { getDb } from "@/lib/mongodb";

/**
 * Next display issue number for the player suggestions forum (`suggestions` collection).
 * Counter key `suggestions` — independent from legacy `feedback` numbering.
 */
export async function getNextSuggestionNumber(): Promise<number> {
  const db = await getDb();

  const maxDoc = await db
    .collection<{ issueNumber?: number }>("suggestions")
    .findOne({ issueNumber: { $exists: true } }, { sort: { issueNumber: -1 } });
  const maxExisting = maxDoc?.issueNumber ?? 0;

  const result = await db
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: "suggestions" },
      [
        { $set: { seq: { $max: [{ $ifNull: ["$seq", 0] }, maxExisting] } } },
        { $set: { seq: { $add: ["$seq", 1] } } },
      ],
      { upsert: true, returnDocument: "after" }
    );

  return result?.seq ?? maxExisting + 1;
}
