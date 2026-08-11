import { ObjectId, type Db } from "mongodb";
import type { Character } from "./types/character";
import type { User } from "./types/user";

/** Minimal character info returned by bulk lookups. */
export interface CharacterNameEntry {
  name: string;
  sequentialId?: number;
  avatarUrl?: string;
}

/**
 * Fetch name/sequentialId/avatarUrl for a list of character IDs.
 * Returns a Map keyed by stringified _id.
 *
 * Handles deduplication and empty arrays. Pass `includeAvatar: true`
 * to include avatarUrl in the projection.
 */
export async function bulkFetchCharacterNames(
  db: Db,
  ids: (string | ObjectId)[],
  opts?: { includeAvatar?: boolean }
): Promise<Map<string, CharacterNameEntry>> {
  if (ids.length === 0) return new Map();

  const unique = [...new Set(ids.map((id) => id.toString()))];
  const objectIds = unique.map((id) => new ObjectId(id));

  const projection: Record<string, 1> = { _id: 1, name: 1, sequentialId: 1 };
  if (opts?.includeAvatar) projection.avatarUrl = 1;

  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: objectIds } }, { projection })
    .toArray();

  return new Map(
    characters.map((c) => [
      c._id.toString(),
      {
        name: c.name,
        sequentialId: c.sequentialId,
        ...(opts?.includeAvatar ? { avatarUrl: c.avatarUrl } : {}),
      },
    ])
  );
}

/**
 * Active regular character for this account. When `users.activeCharacterId` is set
 * (multi-character accounts), resolves that document; otherwise the character
 * matching `userId` alone. Matches `/api/auth/me` regular-character resolution.
 */
export async function getCharacterByUserId(
  db: Db,
  userId: string | ObjectId
): Promise<Character | null> {
  const uid = new ObjectId(userId.toString());
  const user = await db
    .collection<User>("users")
    .findOne({ _id: uid }, { projection: { activeCharacterId: 1 } });
  const characterQuery = user?.activeCharacterId
    ? { _id: user.activeCharacterId, userId: uid }
    : { userId: uid };
  return db.collection<Character>("characters").findOne(characterQuery);
}
