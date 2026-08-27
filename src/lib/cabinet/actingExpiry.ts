import type { Db, ObjectId } from "mongodb";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { notifyAndRestoreClearedHolders } from "@/lib/cabinetTransition";
import type { CountryId } from "@/lib/constants/countries";

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
  // Every lapsed appointment expires, with no country filter. `actingExpiresOnTurn`
  // is a promise made when the seat was taken, and honouring it cannot depend on
  // what the country config says later: gating here would strand an existing
  // caretaker as immortal the moment a country stopped running acting
  // appointments. Eligibility is enforced where it belongs, at appointment time.
  const inScope = await members
    .find({ acting: true, actingExpiresOnTurn: { $lte: currentTurn } })
    .toArray();
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
  // The helper also notifies, so it carries the wording. Letting it use its
  // default would tell a lapsed caretaker their government had fallen, and
  // sending a second notice of our own would double up.
  for (const [countryId, characterIds] of byCountry) {
    await notifyAndRestoreClearedHolders(db, countryId, characterIds, {
      title: "Acting Appointment Ended",
      message:
        "Your acting cabinet appointment has lapsed. The seat is vacant until the Senate confirms a nominee.",
    });
  }

  return { expired: inScope.length };
}
