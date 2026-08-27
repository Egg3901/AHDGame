import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { standDownCountry } from "./leaveConflict";
import { hostEntitiesOf } from "./hostEntities";
import { recordTruce } from "./truce";

/** Every country that fought here, both rosters, deduped. */
function belligerents(c: ConflictDoc): CountryId[] {
  return Array.from(new Set([...c.sideA.countries, ...c.sideB.countries]));
}

/**
 * Stand a conflict down. Records the outcome, then walks every belligerent out of it
 * through `standDownCountry` — the same exit a separate peace uses for one country,
 * so the two cannot drift.
 *
 * Spec: docs/superpowers/specs/2026-07-26-occupation-territory-design.md
 */
export async function resolveConflict(
  db: Db,
  conflict: ConflictDoc,
  winner: "A" | "B" | "stalemate",
  currentTurn: number
): Promise<void> {
  const hosts = hostEntitiesOf(conflict).join(" and ");
  // Every host, not just the map anchor: a proxy war can be fought over two
  // countries and both change hands, so naming one of them reads as a partial
  // victory the record does not mean.
  const note =
    winner === "stalemate"
      ? `Neither side prevailed. ${hosts} stands as it did before the war.`
      : `${winner === "A" ? conflict.sideA.label : conflict.sideB.label} took full control of ${hosts}.`;
  await getConflictsCollection(db).updateOne(
    { _id: conflict._id },
    {
      $set: {
        status: "resolved" as const,
        endTurn: currentTurn,
        outcome: { winner, note },
      },
    }
  );

  for (const countryId of belligerents(conflict)) {
    await standDownCountry(db, conflict, countryId);
  }

  // ANY war ending starts a truce, not only one ended by a deal. Without this, a
  // country conquered on turn 100 could be re-declared on the moment the attacker's
  // 120-turn cooldown lapsed — at the point it is least able to resist.
  //
  // Every CROSS-side pair, not just the principals: an ally who did the fighting
  // would otherwise be free to re-declare immediately while the principal could not.
  // Same-side pairs are never truced — they were not at war with each other.
  for (const a of conflict.sideA.countries) {
    for (const b of conflict.sideB.countries) {
      await recordTruce(db, a, b, currentTurn);
    }
  }
}
