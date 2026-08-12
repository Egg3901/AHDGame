/**
 * Resolve display names for union presidents.
 *
 * `Union.ownerId` points at `characters` for players and `npps` for NPP-run
 * unions (`ownerType`). Callers that only look up characters render "Unknown"
 * for every NPP president even though the seat is filled.
 */
import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import type { Union } from "@/lib/db/types/union";

export interface UnionOwnerDisplay {
  id: string;
  name: string;
  sequentialId: number | null;
  avatarUrl: string | null;
  isNPP: boolean;
}

type OwnerRef = Pick<Union, "ownerId" | "ownerType">;

function isNppOwner(union: OwnerRef): boolean {
  return union.ownerType === "npp";
}

/**
 * Bulk-resolve owner display rows keyed by stringified `ownerId`.
 * Missing/retired docs are omitted — callers fall back to "Unknown".
 */
export async function resolveUnionOwners(
  db: Db,
  unions: readonly OwnerRef[],
  opts?: { includeAvatar?: boolean }
): Promise<Map<string, UnionOwnerDisplay>> {
  const characterIds: ObjectId[] = [];
  const nppIds: ObjectId[] = [];
  for (const union of unions) {
    if (!union.ownerId) continue;
    if (isNppOwner(union)) nppIds.push(union.ownerId);
    else characterIds.push(union.ownerId);
  }

  const projection: Record<string, 1> = { _id: 1, name: 1, sequentialId: 1 };
  if (opts?.includeAvatar) projection.avatarUrl = 1;

  const [characters, npps] = await Promise.all([
    characterIds.length
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds } }, { projection })
          .toArray()
      : Promise.resolve([]),
    nppIds.length
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } }, { projection })
          .toArray()
      : Promise.resolve([]),
  ]);

  const out = new Map<string, UnionOwnerDisplay>();
  for (const character of characters) {
    out.set(character._id.toString(), {
      id: character._id.toString(),
      name: character.name,
      sequentialId: character.sequentialId ?? null,
      avatarUrl: opts?.includeAvatar ? (character.avatarUrl ?? null) : null,
      isNPP: false,
    });
  }
  for (const npp of npps) {
    out.set(npp._id.toString(), {
      id: npp._id.toString(),
      name: npp.name,
      sequentialId: npp.sequentialId ?? null,
      avatarUrl: opts?.includeAvatar ? (npp.avatarUrl ?? null) : null,
      isNPP: true,
    });
  }
  return out;
}

/** Resolve a single union's president, or null when vacant / unresolved. */
export async function resolveUnionOwner(
  db: Db,
  union: OwnerRef,
  opts?: { includeAvatar?: boolean }
): Promise<UnionOwnerDisplay | null> {
  if (!union.ownerId) return null;
  const map = await resolveUnionOwners(db, [union], opts);
  return map.get(union.ownerId.toString()) ?? null;
}
