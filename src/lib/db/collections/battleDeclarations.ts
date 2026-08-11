import type { Db } from "mongodb";
import type { BattleDeclarationDoc } from "@/lib/db/types/battleDeclaration";
import type { CountryId } from "@/lib/constants/countries";

export function getBattleDeclarationsCollection(db: Db) {
  return db.collection<BattleDeclarationDoc>("battleDeclarations");
}

/** The one pending declaration for a country at a theater, or null. */
export async function getPendingDeclaration(
  db: Db,
  declarerCountry: string,
  theaterId: string
): Promise<BattleDeclarationDoc | null> {
  return getBattleDeclarationsCollection(db).findOne({
    declarerCountry: declarerCountry as CountryId,
    theaterId,
    status: "pending",
  });
}

/** Every pending declaration across all countries (turn processor). */
export async function listPendingDeclarations(db: Db): Promise<BattleDeclarationDoc[]> {
  return getBattleDeclarationsCollection(db).find({ status: "pending" }).toArray();
}

/** A country's pending declarations (surfaced to its War Room). */
export async function listPendingForCountry(
  db: Db,
  declarerCountry: string
): Promise<BattleDeclarationDoc[]> {
  return getBattleDeclarationsCollection(db)
    .find({ declarerCountry: declarerCountry as CountryId, status: "pending" })
    .toArray();
}

/** The most recent resolved or fizzled offensives at a conflict. */
export async function listDeclarationHistory(
  db: Db,
  theaterId: string,
  limit = 3
): Promise<BattleDeclarationDoc[]> {
  return getBattleDeclarationsCollection(db)
    .find({ theaterId, status: { $in: ["resolved", "fizzled"] } })
    .sort({ declaredTurn: -1 })
    .limit(limit)
    .toArray();
}
