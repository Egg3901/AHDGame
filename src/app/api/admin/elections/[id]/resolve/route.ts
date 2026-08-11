/**
 * POST /api/admin/elections/[id]/resolve
 * Admin: Force-resolve a single election (mark completed, run resolution).
 * Only for elections past primary (in general phase).
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getGameTime } from "@/lib/time/gameTime";
import { resolveGeneralElections } from "@/lib/turn/electionResolution";
import { initElectionVoteTally } from "@/lib/electionEngine";
import { initPresidentVoteTally } from "@/lib/presidentialElectionEngine";
import { isPrimaryEnded } from "@/lib/elections/phases";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/admin/elections/[id]/resolve — Force-resolves a single election that is past its primary phase, marking it completed and running resolution logic.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id: electionId } = await params;
    let electionObjectId: ObjectId;
    try {
      electionObjectId = new ObjectId(electionId);
    } catch {
      return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
    }

    const db = await getDb();
    // Use game-clock effective-now + current turn for the primary-phase guard
    // so an admin resolving via this route gets the same answer the cron would.
    const gameTime = await getGameTime();
    const now = gameTime.effectiveNow;
    const { currentTurn } = gameTime;

    const election = await db.collection<Election>("elections").findOne({
      _id: electionObjectId,
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    if (election.status === "completed") {
      return NextResponse.json({ error: "Election is already completed" }, { status: 400 });
    }

    // Must be past primary (in general phase) — turn-first with Date fallback.
    if (!isPrimaryEnded(election, currentTurn, gameTime)) {
      return NextResponse.json(
        { error: "Cannot resolve: election is still in primary phase. End primary first." },
        { status: 400 }
      );
    }

    // Ensure vote tally exists (init if missing so resolution can run)
    const tally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: electionObjectId });
    if (!tally) {
      const candidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: electionObjectId, status: "active" })
        .toArray();
      if (election.electionType === "president") {
        await initPresidentVoteTally(electionObjectId, candidates);
      } else {
        await initElectionVoteTally(electionObjectId, candidates, election.state as string);
      }
    }

    // Mark as completed so resolveGeneralElections picks it up
    await db.collection<Election>("elections").updateOne(
      { _id: electionObjectId },
      {
        $set: {
          status: "completed",
          endTime: now,
          endTurn: currentTurn,
          updatedAt: now,
        },
      }
    );

    const resolved = await resolveGeneralElections(now);

    return NextResponse.json({
      success: true,
      message: `Election resolved. ${resolved} election(s) processed.`,
      resolved,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
