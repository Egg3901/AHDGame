import type { Db, ObjectId } from "mongodb";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { notifyAndRestoreClearedHolders } from "@/lib/cabinetTransition";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { actingAppointmentsEnabled } from "./actingEligibility";
import type { CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";

/**
 * Clear acting cabinet holders whose tenure has run out.
 *
 * The seat falls vacant, and because the charge that authorised the
 * appointment is never refunded, it can only be refilled by confirmation for
 * the rest of that presidency. That is what makes the tenure cap bite rather
 * than simply cycling caretakers.
 *
 * Runs inside the existing `cabinetNominations` turn phase rather than as a
 * phase of its own: the phase registry indexes its results by arithmetic, so
 * inserting a phase there is needlessly fragile.
 */
export async function expireLapsedActingAppointments(
  db: Db,
  currentTurn: number
): Promise<{ expired: number }> {
  const members = getCabinetMembersCollection(db);
  const lapsed = await members
    .find({ acting: true, actingExpiresOnTurn: { $lte: currentTurn } })
    .toArray();

  // A country that no longer runs acting appointments keeps whatever it has
  // rather than having seats yanked by a rule that no longer applies to it.
  const inScope = lapsed.filter((m) => actingAppointmentsEnabled(m.countryId));
  if (inScope.length === 0) return { expired: 0 };

  await members.deleteMany({ _id: { $in: inScope.map((m) => m._id) } });

  // Restore office state per country, since the helper is country-scoped. This
  // is what stops a lapsed holder drawing the cabinet office-action bonus.
  const byCountry = new Map<CountryId, ObjectId[]>();
  for (const member of inScope) {
    if (!member.characterId) continue;
    const bucket = byCountry.get(member.countryId) ?? [];
    bucket.push(member.characterId);
    byCountry.set(member.countryId, bucket);
  }
  for (const [countryId, characterIds] of byCountry) {
    await notifyAndRestoreClearedHolders(db, countryId, characterIds);
  }

  // Notifications are keyed by user, so resolve the holders' accounts. One
  // query rather than one per holder.
  const characterIds = [...byCountry.values()].flat();
  const characters = characterIds.length
    ? await db
        .collection<Character>("characters")
        .find({ _id: { $in: characterIds } }, { projection: { _id: 1, userId: 1 } })
        .toArray()
    : [];

  const notifications: NotificationInput[] = characters
    .filter((c) => c.userId)
    .map((c) => ({
      userId: c.userId,
      type: "system",
      title: "Acting Appointment Ended",
      message:
        "Your acting cabinet appointment has lapsed. The seat is vacant until the Senate confirms a nominee.",
    }));
  await createNotifications(notifications);

  return { expired: inScope.length };
}
