import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";

interface CeoVote {
  corporationId: unknown;
  voterCharacterId: unknown;
  candidateCharacterId: unknown;
}

/**
 * GET /api/admin/heal/corporation-ceo-vacant
 * Diagnose corporations that have an active CEO (ceoId set, not vacant) but are
 * missing the explicit ceoVacant field. These corps may be treated as vacant by
 * code that checks ceoVacant without a fallback.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Corps with a ceoId but no ceoVacant field at all
    const missingField = await db
      .collection<Corporation>("corporations")
      .find({
        ceoId: { $ne: null as unknown as undefined },
        ceoVacant: { $exists: false },
      })
      .project({ _id: 1, name: 1, sequentialId: 1, ceoId: 1 })
      .toArray();

    // Corps where ceoVacant is explicitly undefined/null (not boolean)
    const nullField = await db
      .collection<Corporation>("corporations")
      .find({
        ceoId: { $ne: null as unknown as undefined },
        ceoVacant: { $type: "null" },
      })
      .project({ _id: 1, name: 1, sequentialId: 1, ceoId: 1 })
      .toArray();

    const allAffected = [...missingField, ...nullField];
    const seen = new Set<string>();
    const deduped = allAffected.filter((c) => {
      const id = c._id.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return NextResponse.json({
      totalAffected: deduped.length,
      missingCeoVacant: missingField.length,
      nullCeoVacant: nullField.length,
      corporations: deduped.map((c) => ({
        id: c._id.toString(),
        sequentialId: c.sequentialId ?? 0,
        name: c.name,
        ceoId: c.ceoId?.toString() ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/corporation-ceo-vacant
 * For every corporation with an active CEO but missing ceoVacant field:
 * 1. Set ceoVacant: false
 * 2. Upsert a CEO vote from the current CEO for themselves (weighted by their shares)
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Find corps missing the ceoVacant field that have a CEO
    const affected = await db
      .collection<Corporation>("corporations")
      .find({
        ceoId: { $ne: null as unknown as undefined },
        $or: [{ ceoVacant: { $exists: false } }, { ceoVacant: { $type: "null" } }],
      })
      .toArray();

    if (affected.length === 0) {
      return NextResponse.json({
        message: "No corporations need healing — all have ceoVacant set",
        healed: 0,
      });
    }

    let healed = 0;
    let votesCreated = 0;

    for (const corp of affected) {
      // Set ceoVacant: false explicitly
      await db
        .collection<Corporation>("corporations")
        .updateOne({ _id: corp._id }, { $set: { ceoVacant: false, updatedAt: now } });

      // Upsert a CEO self-vote so they're the elected leader
      if (corp.ceoId) {
        await db.collection<CeoVote>("corporationCeoVotes").updateOne(
          { corporationId: corp._id, voterCharacterId: corp.ceoId },
          {
            $set: {
              candidateCharacterId: corp.ceoId,
              updatedAt: now,
            },
            $setOnInsert: {
              corporationId: corp._id,
              voterCharacterId: corp.ceoId,
              createdAt: now,
            },
          },
          { upsert: true }
        );
        votesCreated++;
      }

      healed++;
    }

    return NextResponse.json({
      message: `Healed ${healed} corporation(s) — set ceoVacant: false and created CEO self-votes`,
      healed,
      votesCreated,
      corporations: affected.map((c) => ({
        id: c._id.toString(),
        sequentialId: c.sequentialId ?? 0,
        name: c.name,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
