/**
 * POST /api/admin/officials/cleanup
 *
 * Removes stale ElectedOfficial records for multi-seat races (house, stateSenate):
 *  1. Deletes ALL vacant rows (characterId null, nppId null) — vacancies are
 *     now derived from seat totals, not stored as DB rows.
 *  2. Removes duplicate filled rows for the same character/NPP.
 *  3. Clears currentOffice on characters whose official record no longer exists.
 *
 * Idempotent — safe to run multiple times.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import { ObjectId } from "mongodb";

// POST /api/admin/officials/cleanup — Removes vacant and duplicate house/stateSenate official records and clears stale currentOffice on affected characters.
// Auth: requireAdmin
// Errors: 401, 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Step 1: Delete ALL vacant house/stateSenate rows.
    // Vacancies are computed from known seat totals — they must not be in the DB.
    const vacantResult = await db.collection("electedOfficials").deleteMany({
      officeType: { $in: ["house", "stateSenate"] },
      characterId: null,
      nppId: { $exists: false },
    });
    // Also catch records where nppId is explicitly null
    const vacantResult2 = await db.collection("electedOfficials").deleteMany({
      officeType: { $in: ["house", "stateSenate"] },
      characterId: null,
      nppId: null,
    });
    const vacantDeleted = vacantResult.deletedCount + vacantResult2.deletedCount;

    // Step 2: Remove duplicate filled rows (same character or NPP, same officeType+state).
    const filled = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: { $in: ["house", "stateSenate"] } })
      .toArray();

    const seenChars = new Set<string>();
    const seenNpps = new Set<string>();
    const toDelete: ObjectId[] = [];

    for (const o of filled) {
      if (o.characterId) {
        const key = o.characterId.toString();
        if (seenChars.has(key)) {
          toDelete.push(o._id);
        } else {
          seenChars.add(key);
        }
      } else if (o.nppId) {
        const key = o.nppId.toString();
        if (seenNpps.has(key)) {
          toDelete.push(o._id);
        } else {
          seenNpps.add(key);
        }
      }
    }

    let dupDeleted = 0;
    if (toDelete.length > 0) {
      const r = await db.collection("electedOfficials").deleteMany({ _id: { $in: toDelete } });
      dupDeleted = r.deletedCount;
    }

    // Step 3: Clear currentOffice on characters no longer in electedOfficials.
    const remaining = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: { $in: ["house", "stateSenate"] } })
      .toArray();

    // Typed $nin on _id (characterId is stored as ObjectId) so the query stays
    // indexable instead of $toString-ing every candidate _id in an $expr scan.
    const activeCharIds = remaining.filter((o) => o.characterId).map((o) => o.characterId!);

    const orphaned = await db
      .collection<Character>("characters")
      .find({
        "currentOffice.type": { $in: ["house", "stateSenate"] },
        _id: { $nin: activeCharIds },
      })
      .toArray();

    let clearedOffices = 0;
    for (const char of orphaned) {
      await db
        .collection("characters")
        .updateOne({ _id: char._id }, { $set: { currentOffice: null, updatedAt: new Date() } });
      clearedOffices++;
    }

    return NextResponse.json({
      success: true,
      vacantRowsDeleted: vacantDeleted,
      duplicatesRemoved: dupDeleted,
      orphanedOfficesCleared: clearedOffices,
      message: `Deleted ${vacantDeleted} vacant rows, ${dupDeleted} duplicate rows. Cleared ${clearedOffices} orphaned character offices.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
