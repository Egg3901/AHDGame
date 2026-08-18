import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election, ElectionCandidate, NPP } from "@/lib/db/types";

// POST /api/admin/npps/vacate-primaries — Withdraws all NPP candidates from every active election
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // Get all NPP IDs (the authoritative source)
    const allNPPs = await db.collection<NPP>("npps").find({}).project({ _id: 1 }).toArray();
    const nppIds = allNPPs.map((n) => n._id);

    // Find all active elections
    const activeElections = await db
      .collection<Election>("elections")
      .find({ status: "active" })
      .project({ _id: 1 })
      .toArray();

    const electionIds = activeElections.map((e) => e._id);

    if (electionIds.length === 0) {
      return NextResponse.json({
        success: true,
        withdrawn: 0,
        message: "No active elections found",
      });
    }

    // Withdraw candidates where characterId is an NPP
    // This catches all NPP candidates regardless of isNPP/nppId tagging
    const result = await db.collection<ElectionCandidate>("electionCandidates").updateMany(
      {
        electionId: { $in: electionIds },
        characterId: { $in: nppIds },
        status: "active",
      },
      {
        $set: {
          status: "withdrawn",
          withdrawnAt: now,
        },
      }
    );

    // Also fix tagging on these candidates for consistency
    await db.collection<ElectionCandidate>("electionCandidates").updateMany(
      {
        characterId: { $in: nppIds },
        $or: [{ isNPP: { $ne: true } }, { nppId: { $exists: false } }],
      },
      [
        {
          $set: {
            isNPP: true,
            nppId: "$characterId",
          },
        },
      ]
    );

    return NextResponse.json({
      success: true,
      withdrawn: result.modifiedCount,
      electionsChecked: electionIds.length,
      nppCount: nppIds.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
