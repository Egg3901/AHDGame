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
 * GET /api/admin/heal/ceo-votes
 * Diagnose corporations with ceoVacant=true that have stale votes or pendingCeoCharacterId set.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find corporations with vacant CEO position
    const vacantCorps = await db
      .collection<Corporation>("corporations")
      .find({ ceoVacant: true })
      .project({ _id: 1, name: 1, sequentialId: 1, pendingCeoCharacterId: 1 })
      .toArray();

    // Count votes for each vacant corporation
    const diagnostics = await Promise.all(
      vacantCorps.map(async (corp) => {
        const voteCount = await db
          .collection<CeoVote>("corporationCeoVotes")
          .countDocuments({ corporationId: corp._id });

        return {
          id: corp._id.toString(),
          sequentialId: corp.sequentialId ?? 0,
          name: corp.name,
          voteCount,
          hasPendingCeo: !!corp.pendingCeoCharacterId,
        };
      })
    );

    // Filter to only those with issues
    const withIssues = diagnostics.filter((d) => d.voteCount > 0 || d.hasPendingCeo);

    return NextResponse.json({
      totalVacantCorps: vacantCorps.length,
      corpsWithIssues: withIssues.length,
      diagnostics: withIssues,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/ceo-votes
 * Clear all CEO votes and pendingCeoCharacterId for corporations with ceoVacant=true.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Find corporations with vacant CEO position
    const vacantCorps = await db
      .collection<Corporation>("corporations")
      .find({ ceoVacant: true })
      .project({ _id: 1, name: 1, sequentialId: 1 })
      .toArray();

    if (vacantCorps.length === 0) {
      return NextResponse.json({
        message: "No corporations with vacant CEO position found",
        healed: 0,
        votesDeleted: 0,
      });
    }

    const corpIds = vacantCorps.map((c) => c._id);

    // Delete all CEO votes for these corporations
    const deleteResult = await db
      .collection<CeoVote>("corporationCeoVotes")
      .deleteMany({ corporationId: { $in: corpIds } });

    // Clear pendingCeoCharacterId for these corporations
    const updateResult = await db.collection<Corporation>("corporations").updateMany(
      { _id: { $in: corpIds }, pendingCeoCharacterId: { $exists: true } },
      {
        $unset: { pendingCeoCharacterId: "" },
        $set: { updatedAt: now },
      }
    );

    return NextResponse.json({
      message: `Healed ${vacantCorps.length} corporation(s) with vacant CEO`,
      healed: vacantCorps.length,
      votesDeleted: deleteResult.deletedCount,
      pendingCeoCleared: updateResult.modifiedCount,
      corporations: vacantCorps.map((c) => ({
        id: c._id.toString(),
        sequentialId: c.sequentialId,
        name: c.name,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
