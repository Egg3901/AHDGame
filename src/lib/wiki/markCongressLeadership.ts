/**
 * Mark that a character has held Congress leadership.
 * Call when a character is placed into or wins a Congress leadership role.
 * Skips if the ID is an NPP (only characters get politician pages).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, PoliticianOverride } from "@/lib/db/types";

export async function markCongressLeadershipHeld(
  db: Db,
  assignedId: string,
  now: Date
): Promise<void> {
  const char = await db.collection<Character>("characters").findOne({
    _id: new ObjectId(assignedId),
  });
  if (!char) return;

  const existing = await db.collection<PoliticianOverride>("politicianOverrides").findOne({
    politicianId: assignedId,
  });

  if (existing) {
    await db
      .collection<PoliticianOverride>("politicianOverrides")
      .updateOne(
        { politicianId: assignedId },
        { $set: { hasHeldCongressLeadership: true, updatedAt: now } }
      );
  } else {
    await db.collection<PoliticianOverride>("politicianOverrides").insertOne({
      politicianId: assignedId,
      hasHeldCongressLeadership: true,
      updatedAt: now,
    } as PoliticianOverride);
  }
}
