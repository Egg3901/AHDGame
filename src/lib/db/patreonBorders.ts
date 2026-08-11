import type { Db } from "@/lib/mongodb";
import type { User } from "@/lib/db/types";
import type { ProfileBorderKey } from "@/lib/db/types";
import { ObjectId } from "mongodb";

export interface BorderData {
  borderKey: ProfileBorderKey | null;
  tintColor: string | null;
}

const EMPTY_MAP = new Map<string, BorderData>();

/**
 * Batch-fetch patreon border cosmetics for a set of user IDs.
 * Returns a Map keyed by user ID string → { borderKey, tintColor }.
 *
 * Callers that already have characters can look up via `character.userId`:
 *   const borders = await fetchBordersByUserIds(db, chars.map(c => c.userId));
 *   const b = borders.get(char.userId.toString());
 */
export async function fetchBordersByUserIds(
  db: Db,
  userIds: (ObjectId | string)[]
): Promise<Map<string, BorderData>> {
  if (userIds.length === 0) return EMPTY_MAP;

  const objectIds = [...new Set(userIds.map((id) => id.toString()))]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  if (objectIds.length === 0) return EMPTY_MAP;

  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: objectIds } })
    .project<Pick<User, "_id" | "patreonProfileBorder" | "patreonHighlightColor">>({
      _id: 1,
      patreonProfileBorder: 1,
      patreonHighlightColor: 1,
    })
    .toArray();

  return new Map(
    users.map((u) => [
      u._id.toString(),
      {
        borderKey: (u.patreonProfileBorder as ProfileBorderKey | undefined) ?? null,
        tintColor: u.patreonHighlightColor ?? null,
      },
    ])
  );
}
