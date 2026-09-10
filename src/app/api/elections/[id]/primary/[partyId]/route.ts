import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
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
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    // Its own read budget, matching the wire feed this screen also polls.
    // The shared `election:` bucket is 20/minute and every other member of it
    // is an action the player takes (enter, vote, surge, travel); browsing
    // parties here must not spend the budget they need to act.
    const rateLimit = checkRateLimit(auth.user.userId, 60, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, partyId } = await params;

    const parsedPartyId = partyIdSchema.safeParse(partyId);
    if (!parsedPartyId.success) {
      return NextResponse.json({ error: "Invalid party id" }, { status: 400 });
    }

    const db = await getDb();

    // A race is addressed either by ObjectId or by seat slug ("US-president"),
    // which is the form the election pages actually link to.
    const resolved = await resolveElectionRouteParam(db, id);
    if (!resolved.ok) {
      const invalid = resolved.reason === "invalid_id";
      return NextResponse.json(
        { error: invalid ? "Invalid election id" : "Election not found" },
        { status: invalid ? 400 : 404 }
      );
    }

    // The screen this feeds only exists for a presidential primary; anything
    // else is a 404 rather than an empty shell the client has to interpret.
    const election = resolved.election;
    if (election.electionType !== "president") {
      return NextResponse.json({ error: "Not a presidential race" }, { status: 404 });
    }

    const detail = await buildPrimaryPartyDetail(db, {
      election,
      partyId: parsedPartyId.data,
      // The active profile, so this resolves the same character the deep-dive
      // page does and the two never disagree about whose campaign is shown.
      viewer: {
        userId: auth.user.userId,
        activeCharacterId: auth.user.activeCharacterId ?? null,
      },
    });
    if (!detail) {
      return NextResponse.json({ error: "Party not in this race" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    return handleRouteError(error, {
      request,
      route: "/api/elections/[id]/primary/[partyId]",
    });
  }
}
