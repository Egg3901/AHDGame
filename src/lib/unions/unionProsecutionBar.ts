import type { Db, ObjectId } from "mongodb";
import type { UnionOrganizer } from "@/lib/db/types/union";
import { getCurrentTurn } from "@/lib/currentTurn";

export const UNION_PROSECUTION_MESSAGE = "You are barred from union actions by prosecution.";

/** A prosecution follows the character across unions until its final barred turn. */
export async function isUnionProsecutionBarred(db: Db, characterId: ObjectId): Promise<boolean> {
  const turn = await getCurrentTurn(db);
  const bar = await db.collection<UnionOrganizer>("unionOrganizers").findOne({
    characterId,
    barredUntilTurn: { $gte: turn },
  });
  return bar !== null;
}
