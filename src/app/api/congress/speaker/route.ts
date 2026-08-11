/**
 * GET  /api/congress/speaker  — current Speaker, active election (24h window), candidacies
 * POST /api/congress/speaker  — declare | withdraw | vote | start_election (admin)
 *
 * Model: 24-hour voting period. Any seated House member may run and vote.
 * Plurality winner (top vote-getter) wins; no absolute majority required.
 * U.S. congressional leadership races are player-only; NPPs do not run or vote.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getPartyMap } from "@/lib/db/partyMap";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getAuthUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { speakerActionSchema } from "@/lib/api/schemas/congress";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { vacateSpeakerIfLostSeat } from "@/lib/congress/speaker/vacateSpeakerIfLostSeat";
import { resolveSpeakerElection } from "@/lib/congress/speaker/resolveSpeakerElection";
import { resolveSpeakerVacateMotion } from "@/lib/congress/speaker/resolveVacateMotion";
import { buildSpeakerResponse } from "@/lib/congress/speaker/responseBuilder";
import { handleSpeakerAction } from "@/lib/congress/speaker/actions";
import { getGameTime } from "@/lib/time/gameTime";
import { isLeadershipElectionClosed } from "@/lib/congress/leadershipElections";
import type { SpeakerElection } from "@/lib/db/types";

// Re-export types for frontend
export type {
  SpeakerDisplay,
  CandidacyDisplay,
  SpeakerResponse,
} from "@/lib/congress/speaker/types";

// GET /api/congress/speaker — Returns the current Speaker, active election state, and candidacies.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const db = await getDb();
    const partyMap = await getPartyMap(db, "US");
    const house = await getHouseComposition(db, partyMap);
    const authUser = await getAuthUser().catch(() => null);

    await vacateSpeakerIfLostSeat(db);

    const electionDoc = await db
      .collection<SpeakerElection>("speakerElections")
      .findOne({ _id: "current" });
    if (electionDoc?.status === "voting") {
      const gameTime = await getGameTime();
      if (isLeadershipElectionClosed(electionDoc, gameTime.currentTurn, gameTime.effectiveNow)) {
        await resolveSpeakerElection(db, partyMap);
      }
    }

    // Lazily resolve a motion to vacate (passed by majority, or window closed).
    // May vacate the Speaker and open a fresh election, so run before building.
    await resolveSpeakerVacateMotion(db, house);

    const response = await buildSpeakerResponse({
      db,
      partyMap,
      house,
      authUser,
    });

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/congress/speaker — Handles Speaker election actions: declare, withdraw, vote, or start_election (admin).
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, speakerActionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action, nominationId, vacateVote } = parsed.data;

    const db = await getDb();
    const partyMap = await getPartyMap(db, "US");
    const house = await getHouseComposition(db, partyMap);

    const result = await handleSpeakerAction({
      db,
      partyMap,
      house,
      authUser,
      action,
      nominationId,
      vacateVote,
    });

    if (result.success) {
      return NextResponse.json({ message: result.message }, { status: result.status ?? 200 });
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
