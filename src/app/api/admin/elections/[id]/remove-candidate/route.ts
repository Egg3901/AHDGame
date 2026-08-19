/**
 * POST /api/admin/elections/[id]/remove-candidate
 * Admin: Withdraw a candidate from any election (to allow swapping/replacing).
 * Body: { candidateId: string }
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Election, ElectionCandidate } from "@/lib/db/types";

const removeCandidateSchema = z.object({
  candidateId: z.string().min(1),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/admin/elections/[id]/remove-candidate — Withdraws a candidate from an election and deletes their campaign document.
// Auth: requireAdmin
// Errors: 400, 403, 404
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

    const parsed = await parseJsonBody(request, removeCandidateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const candidateId = parsed.data.candidateId;

    const db = await getDb();
    const now = new Date();

    const election = await db.collection<Election>("elections").findOne({
      _id: electionObjectId,
    });

    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    if (election.status !== "upcoming" && election.status !== "active") {
      return NextResponse.json({ error: "Election is not open" }, { status: 400 });
    }

    let candidateObjectId: ObjectId;
    try {
      candidateObjectId = new ObjectId(candidateId);
    } catch {
      return NextResponse.json({ error: "Invalid candidate ID" }, { status: 400 });
    }

    const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      _id: candidateObjectId,
      electionId: electionObjectId,
      status: "active",
    });

    if (!candidate) {
      return NextResponse.json(
        { error: "Candidate not found or already withdrawn" },
        { status: 404 }
      );
    }

    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne({ _id: candidateObjectId }, { $set: { status: "withdrawn", withdrawnAt: now } });

    // Archive (not delete) their campaign so it survives until the election
    // resolves and a re-entry can reactivate it.
    if (candidate.characterId) {
      await db.collection("campaigns").updateOne(
        {
          electionId: electionObjectId,
          candidateId: candidate.characterId,
          status: { $ne: "archived" },
        },
        {
          $set: {
            status: "archived",
            archivedAt: now,
            archivedReason: "removed",
            updatedAt: now,
          },
        }
      );
    }

    const typeLabel =
      election.electionType === "president" ? "presidential" : election.electionType;
    return NextResponse.json({
      success: true,
      message: `${candidate.characterName} has been removed from the ${typeLabel} race.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
