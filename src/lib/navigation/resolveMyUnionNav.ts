import type { Db, ObjectId } from "mongodb";
import type { Union, UnionOrganizer } from "@/lib/db/types";

export interface MyUnionNav {
  id: string;
}

/**
 * The union this character should land on from the Profile dropdown: the
 * union they lead, otherwise the union they organize in (highest banked
 * strength, then most recently updated). Null when they have neither.
 */
export async function resolveMyUnionNav(
  db: Db,
  character: { _id: ObjectId; unionLeaderOf?: ObjectId | null }
): Promise<MyUnionNav | null> {
  if (character.unionLeaderOf) {
    const led = await db
      .collection<Union>("unions")
      .findOne({ _id: character.unionLeaderOf }, { projection: { _id: 1 } });
    if (led) return { id: led._id.toString() };
  }

  const organizer = await db
    .collection<UnionOrganizer>("unionOrganizers")
    .findOne(
      { characterId: character._id },
      { sort: { strength: -1, updatedAt: -1 }, projection: { unionId: 1 } }
    );
  if (!organizer) return null;

  const organized = await db
    .collection<Union>("unions")
    .findOne({ _id: organizer.unionId }, { projection: { _id: 1 } });
  return organized ? { id: organized._id.toString() } : null;
}
