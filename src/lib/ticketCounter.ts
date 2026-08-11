import { getDb } from "@/lib/mongodb";

/**
 * Next display ticket number for the Discord support tickets (`tickets` collection).
 * Counter key `tickets` — independent from `suggestions` and legacy `feedback` numbering.
 * Mirrors {@link getNextSuggestionNumber}: seeds the counter from the current max so it
 * stays correct even if the counter doc is missing or behind.
 */
export async function getNextTicketNumber(): Promise<number> {
  const db = await getDb();

  const maxDoc = await db
    .collection<{ ticketNumber?: number }>("tickets")
    .findOne({ ticketNumber: { $exists: true } }, { sort: { ticketNumber: -1 } });
  const maxExisting = maxDoc?.ticketNumber ?? 0;

  const result = await db
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: "tickets" },
      [
        { $set: { seq: { $max: [{ $ifNull: ["$seq", 0] }, maxExisting] } } },
        { $set: { seq: { $add: ["$seq", 1] } } },
      ],
      { upsert: true, returnDocument: "after" }
    );

  return result?.seq ?? maxExisting + 1;
}
