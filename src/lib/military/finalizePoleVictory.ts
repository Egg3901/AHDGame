import type { Db, Filter } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import type { ConflictDoc, ConflictStatus } from "@/lib/db/types/conflict";
import { standDownCountry } from "@/lib/military/leaveConflict";
import { DICTATE_WINDOW_TURNS, principalOf } from "@/lib/military/principal";
import { resolveConflict } from "@/lib/military/resolveConflict";
import type { Side } from "@/lib/military/occupation";

/**
 * Stop a pole-winning war and either open its terms window or resolve it outright.
 *
 * Kept outside the battle resolver because a side may reach the pole before the
 * minimum duration elapses. The turn sweep then needs to perform the same transition
 * on a quiet turn, without manufacturing another engagement.
 */
export async function finalizePoleVictory(
  db: Db,
  conflict: ConflictDoc,
  victor: Side,
  currentTurn: number
): Promise<Extract<ConflictStatus, "terms_pending" | "resolved"> | null> {
  const imposer = principalOf(conflict, victor);
  const target = principalOf(conflict, victor === "A" ? "B" : "A");
  const conflicts = await getConflictsCollection(db);
  const liveAtPole = {
    _id: conflict._id,
    status: { $nin: ["resolved", "terms_pending"] },
    control: victor === "A" ? 0 : 100,
    poleSide: victor,
    poleSinceTurn: { $ne: null },
  } as Filter<ConflictDoc>;

  // A generated side has no government to address, and a side whose founder already
  // made separate peace has nobody left holding the claim. Those wars resolve without
  // a terms window, matching the pre-duration path.
  if (!imposer || !target) {
    const claim = await conflicts.updateOne(liveAtPole, { $set: { status: "resolved" } });
    if (claim.modifiedCount === 0) return null;
    await resolveConflict(db, conflict, victor, currentTurn);
    return "resolved";
  }

  const termsWindow = {
    victor,
    imposer,
    target,
    closesTurn: currentTurn + DICTATE_WINDOW_TURNS,
  } satisfies {
    victor: Side;
    imposer: CountryId;
    target: CountryId;
    closesTurn: number;
  };
  const claim = await conflicts.updateOne(liveAtPole, {
    $set: { status: "terms_pending", termsWindow },
  });
  if (claim.modifiedCount === 0) return null;

  for (const countryId of new Set([...conflict.sideA.countries, ...conflict.sideB.countries])) {
    await standDownCountry(db, conflict, countryId);
  }
  return "terms_pending";
}
