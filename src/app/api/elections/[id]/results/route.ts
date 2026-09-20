import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { withApiMetrics } from "@/lib/observability/apiMetrics";
import { isLiveElectionResultsEnabled } from "@/lib/elections/liveResults/featureFlag";
import {
  buildResultsPayload,
  payloadFromSnapshot,
} from "@/lib/elections/liveResults/buildResultsPayload";
import {
  ELECTION_RESULT_SNAPSHOT_VERSION,
  type ElectionResultSnapshot,
} from "@/lib/db/types/electionResultSnapshot";
import type { Election, GameState } from "@/lib/db/types";

const ENDED_STATUSES = new Set(["completed", "resolved", "cancelled"]);

// GET /api/elections/[id]/results - Read-only, polling-optimized live results for one election.
// Auth: public (optional getAuthUser); 403 while the liveElectionResults gate is off for non-admins.
// Errors: 400, 403, 404
async function handleGet(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid election id" }, { status: 400 });
    }

    const db = await getDb();
    const [election, gameState, user] = await Promise.all([
      db.collection<Election>("elections").findOne({ _id: new ObjectId(id) }),
      db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            currentTurn: 1,
            currentYear: 1,
            nextScheduledTurn: 1,
            pausedAt: 1,
            fastMode: 1,
            preset: 1,
            liveElectionResultsEnabled: 1,
          },
        }
      ),
      getAuthUser(),
    ]);

    const isAdmin = user?.isAdmin === true;
    if (!isLiveElectionResultsEnabled(gameState) && !isAdmin) {
      return NextResponse.json({ error: "Live election results are not enabled" }, { status: 403 });
    }
    if (!election) {
      return NextResponse.json({ error: "Election not found" }, { status: 404 });
    }

    // A finished race is served from its frozen snapshot, not recomputed.
    // Recomputation rebuilds the electoral-vote map from the CURRENT game year
    // and reads party names and colours live, so an old race would be scored
    // against a map that was never in force when it ran, under party identities
    // that may since have changed. See ElectionResultSnapshot for the detail.
    //
    // A snapshot whose schemaVersion this build does not recognise falls
    // through to live computation rather than rendering a shape it cannot read.
    if (ENDED_STATUSES.has(election.status)) {
      const snapshot = await db
        .collection<ElectionResultSnapshot>("electionResultSnapshots")
        .findOne({ electionId: election._id });
      if (snapshot && snapshot.schemaVersion === ELECTION_RESULT_SNAPSHOT_VERSION) {
        return conditionalJson(
          request,
          payloadFromSnapshot(
            snapshot,
            {
              id: election._id.toString(),
              state: election.state,
              status: election.status,
              startTurn: election.startTurn ?? null,
              endTurn: election.endTurn ?? null,
            },
            { currentTurn: gameState?.currentTurn ?? 0, isAdmin }
          )
        );
      }
    }

    const body = await buildResultsPayload(db, election, gameState, {
      // Null means the live game year, which is what a poll on a running race
      // wants. Only a capture pins a specific year.
      apportionmentYear: null,
      isAdmin,
    });

    return conditionalJson(request, body);
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withApiMetrics("elections.results.GET", handleGet);
