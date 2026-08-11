import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { checkRateLimit, ELECTION_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import type { ElectionCandidate } from "@/lib/db/types";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/elections/[id]/withdraw — Withdraws the authenticated character from an active election and removes their vote tally.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) {
      logRequest("POST", path, 401, Date.now() - start);
      return auth.response;
    }

    const { user } = auth;
    const character = user.character;

    const limit = checkRateLimit(
      `election:${user.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const { id: electionId } = await params;

    const db = await getDb();

    const resolved = await resolveElectionRouteParam(db, electionId);
    if (!resolved.ok) {
      if (resolved.reason === "invalid_id") {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json({ error: "Invalid election ID" }, { status: 400 });
      }
      logRequest("POST", path, 404, Date.now() - start);
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    const election = resolved.election;
    const electionObjectId = election._id;

    // Check if election allows withdrawal
    if (
      election.status === "completed" ||
      election.status === "resolved" ||
      election.status === "cancelled"
    ) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        { error: "Cannot withdraw from a completed or cancelled election" },
        { status: 400 }
      );
    }

    // Find the candidate entry
    const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: electionObjectId,
      characterId: character._id,
      status: "active",
    });

    if (!candidate) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json({ error: "You are not entered in this race" }, { status: 400 });
    }

    // Update the candidate status to withdrawn
    const now = new Date();
    await db.collection("electionCandidates").updateOne(
      { _id: candidate._id },
      {
        $set: {
          status: "withdrawn",
          withdrawnAt: now,
        },
      }
    );

    // Remove withdrawn candidate's votes/data from the tally
    await removeWithdrawnCandidateFromTally(db, electionObjectId, candidate._id.toString());

    // Archive (not delete) the candidate's campaign so a re-entry can reactivate
    // it. Hard deletion only happens when the election resolves.
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
            archivedAt: new Date(),
            archivedReason: "withdrawn",
            updatedAt: new Date(),
          },
        }
      );
    }

    recordAudit({
      source: "api",
      action: "election.withdraw",
      category: "election",
      subject: {
        type: "election",
        id: electionObjectId,
        name: `${election.electionType} — ${election.state}`,
      },
      refs: { electionId: electionObjectId },
      meta: {
        candidateId: candidate._id.toString(),
        electionType: election.electionType,
        state: election.state,
      },
      outcome: "ok",
    });

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({
      success: true,
      message: `${character.name} has withdrawn from the ${election.electionType} race in ${election.state}`,
    });
  } catch (error) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(error);
  }
}
