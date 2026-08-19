import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Election, ElectionCandidate } from "@/lib/db/types";

// GET /api/admin/elections/heal-orphan-tallies — Diagnoses candidate records for elections that no longer exist.
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get all election IDs
    const allElections = await db
      .collection<Election>("elections")
      .find({})
      .project({ _id: 1 })
      .toArray();
    const electionIds = new Set(allElections.map((e) => e._id.toString()));

    // Get all candidates and check if their election exists
    const allCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({})
      .project({ electionId: 1 })
      .toArray();

    // Group by election ID and find orphans
    const orphansByElection = new Map<string, number>();
    for (const candidate of allCandidates) {
      const electionId = candidate.electionId.toString();
      if (!electionIds.has(electionId)) {
        orphansByElection.set(electionId, (orphansByElection.get(electionId) ?? 0) + 1);
      }
    }

    const examples = Array.from(orphansByElection.entries())
      .slice(0, 10)
      .map(([electionId, candidateCount]) => ({
        electionId,
        candidateCount,
      }));

    return NextResponse.json({
      orphanTallies: orphansByElection.size,
      examples,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/elections/heal-orphan-tallies — Deletes candidate records for elections that no longer exist.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get all election IDs
    const allElections = await db
      .collection<Election>("elections")
      .find({})
      .project({ _id: 1 })
      .toArray();
    const electionIds = allElections.map((e) => e._id);

    // Delete candidates whose election doesn't exist
    const result = await db.collection<ElectionCandidate>("electionCandidates").deleteMany({
      electionId: { $nin: electionIds },
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({
        message: "No orphan vote tallies found.",
      });
    }

    return NextResponse.json({
      message: `Deleted ${result.deletedCount} orphan candidate record(s).`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
