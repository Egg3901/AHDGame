import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";

/**
 * Broadcast one in-game notification to every resident *player* of a country —
 * deduped by user, so a player with several in-country characters is pinged once.
 * NPCs (no `userId`) are excluded. Used to alert the market when a state spin-out
 * is offered or an auction resolves; recipients match the residency-gated bidding
 * audience, so foreign players (who cannot participate) are not spammed.
 *
 * Best-effort: `createNotifications` swallows + logs its own failures, so a
 * broadcast never aborts the privatization that triggered it.
 */
export async function notifyCountryResidents(
  db: Db,
  countryId: CountryId,
  input: Omit<NotificationInput, "userId">
): Promise<void> {
  // Self-contained best-effort: a recipient-lookup failure must never abort the
  // money-moving privatization that triggered the broadcast.
  try {
    const chars = await db
      .collection<Character>("characters")
      .find({ countryId, userId: { $exists: true } }, { projection: { userId: 1 } })
      .toArray();
    const userIds = new Map<string, ObjectId>();
    for (const c of chars) {
      if (c.userId) userIds.set(String(c.userId), c.userId);
    }
    await createNotifications([...userIds.values()].map((userId) => ({ ...input, userId })));
  } catch (err) {
    console.error("[notifyCountryResidents] broadcast failed:", err);
  }
}
