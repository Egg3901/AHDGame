// GET diagnoses / POST repairs congressionalDistricts whose holderCharacterId
// points at an NPP id (which lives in `npps`, not `characters`). Such seats
// render as unheld. The fix moves the id into holderNppId and nulls
// holderCharacterId. See issue #2906.
// Auth: requireAdmin
// Errors: 401, 500
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { CongressionalDistrict, Character, NPP } from "@/lib/db/types";

/**
 * Find districts whose holderCharacterId does not resolve to a `characters`
 * doc but does resolve to an `npps` doc — i.e. an NPP winner mis-stamped into
 * the character holder field. Returns the list of affected district _ids with
 * the NPP id to move.
 */
async function findMisstampedDistricts(
  db: Awaited<ReturnType<typeof getDb>>
): Promise<{ districtId: string; stateId: string; index: number; nppId: string }[]> {
  const docs = (await db
    .collection<CongressionalDistrict>("congressionalDistricts")
    .find({ holderCharacterId: { $ne: null } })
    .toArray()) as CongressionalDistrict[];
  if (docs.length === 0) return [];

  const holderIds = docs
    .map((d) => d.holderCharacterId)
    .filter((id): id is NonNullable<typeof id> => id != null);

  const realCharIds = new Set(
    (
      (await db
        .collection<Character>("characters")
        .find({ _id: { $in: holderIds } }, { projection: { _id: 1 } })
        .toArray()) as { _id: unknown }[]
    ).map((c) => String(c._id))
  );
  const nppIds = new Set(
    (
      (await db
        .collection<NPP>("npps")
        .find({ _id: { $in: holderIds } }, { projection: { _id: 1 } })
        .toArray()) as { _id: unknown }[]
    ).map((n) => String(n._id))
  );

  const out: { districtId: string; stateId: string; index: number; nppId: string }[] = [];
  for (const d of docs) {
    const id = String(d.holderCharacterId);
    // Mis-stamped: not a real character, but a known NPP.
    if (!realCharIds.has(id) && nppIds.has(id)) {
      out.push({ districtId: d._id, stateId: d.stateId, index: d.index, nppId: id });
    }
  }
  return out;
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const affected = await findMisstampedDistricts(db);
    const byState: Record<string, number> = {};
    for (const a of affected) byState[a.stateId] = (byState[a.stateId] ?? 0) + 1;
    return NextResponse.json({
      affectedCount: affected.length,
      byState,
      sample: affected.slice(0, 20),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const now = new Date();
    const affected = await findMisstampedDistricts(db);

    let healed = 0;
    for (const a of affected) {
      const res = await db.collection<CongressionalDistrict>("congressionalDistricts").updateOne(
        { _id: a.districtId },
        {
          $set: {
            holderNppId: ObjectId.createFromHexString(a.nppId),
            holderCharacterId: null,
            updatedAt: now,
          },
        }
      );
      healed += res.modifiedCount;
    }

    const byState: Record<string, number> = {};
    for (const a of affected) byState[a.stateId] = (byState[a.stateId] ?? 0) + 1;
    return NextResponse.json({ healed, affectedCount: affected.length, byState });
  } catch (error) {
    return handleRouteError(error);
  }
}
