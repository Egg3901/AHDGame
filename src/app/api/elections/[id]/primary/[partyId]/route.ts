import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { clientIpFromRequest } from "@/lib/utils/network";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { buildPrimaryPartyDetail } from "@/lib/elections/primaryPartyDetail";

interface RouteParams {
  params: Promise<{ id: string; partyId: string }>;
}

/** A sequential id ("1") or an abbreviation ("DEM"); never a free-text query. */
const partyIdSchema = z.string().min(1).max(32);

// GET /api/elections/[id]/primary/[partyId] — one party's primary detail:
// per-state votes, state names, which states have voted, and the viewer's own
// campaign state. Fetched lazily by the Blend primary screen when a party is
// selected, rather than folded into the 60s election-detail poll, since most
// viewers never open it and the payload is per-party.
// Auth: optional. Everything in the payload except `viewerCampaign` is public
// (the deep-dive page serves the same board to anyone), and `viewerCampaign`
// is null without a viewer, so a signed-out spectator gets the read-only board.
// Errors: 400, 404, 429
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getAuthUser();

    // Its own read budget, matching the wire feed this screen also polls.
    // The shared `election:` bucket is 20/minute and every other member of it
    // is an action the player takes (enter, vote, surge, travel); browsing
    // parties here must not spend the budget they need to act.
    // Spectators are budgeted per address, since the board is not cheap to build.
    const rateLimit = checkRateLimit(
      user ? user.userId : `anon:${clientIpFromRequest(request)}`,
      60,
      60000
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, partyId } = await params;

    const parsedPartyId = partyIdSchema.safeParse(partyId);
    if (!parsedPartyId.success) {
      return errorResponse(400, "Invalid party id");
    }

    const db = await getDb();

    // A race is addressed either by ObjectId or by seat slug ("US-president"),
    // which is the form the election pages actually link to.
    const resolved = await resolveElectionRouteParam(db, id);
    if (!resolved.ok) {
      const invalid = resolved.reason === "invalid_id";
      return errorResponse(
        invalid ? 400 : 404,
        invalid ? "Invalid election id" : "Election not found"
      );
    }

    // The screen this feeds only exists for a presidential primary; anything
    // else is a 404 rather than an empty shell the client has to interpret.
    const election = resolved.election;
    if (election.electionType !== "president") {
      return errorResponse(404, "Not a presidential race");
    }

    const detail = await buildPrimaryPartyDetail(db, {
      election,
      partyId: parsedPartyId.data,
      // The active profile, so this resolves the same character the deep-dive
      // page does and the two never disagree about whose campaign is shown.
      viewer: user
        ? { userId: user.userId, activeCharacterId: user.activeCharacterId ?? null }
        : null,
    });
    if (!detail) {
      return errorResponse(404, "Party not in this race");
    }

    // A signed-in body carries the viewer's own campaign, so it must never be
    // shared; the spectator body is the same for everyone.
    return NextResponse.json(
      detail,
      user ? { headers: { "Cache-Control": "private, no-store" } } : {}
    );
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "/api/elections/[id]/primary/[partyId]",
    });
  }
}
