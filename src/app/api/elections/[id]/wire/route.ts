import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  getRaceWireFeed,
  RACE_WIRE_DEFAULT_LIMIT,
  RACE_WIRE_MAX_LIMIT,
} from "@/lib/elections/raceWireFeed";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const querySchema = z.object({
  campaignId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(RACE_WIRE_MAX_LIMIT).optional(),
});

// GET /api/elections/[id]/wire — recent wire headlines for one race, newest first.
// Feeds the ticker strip on the campaign manager and election screens.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 60, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      campaignId: url.searchParams.get("campaignId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
    }

    const db = await getDb();

    // A race is addressed either by ObjectId or by seat slug ("US-president"),
    // so this resolves the segment the way the detail route does. Requiring an
    // ObjectId here 400'd every ticker fetch made from a slug URL, which is the
    // form the election pages actually link to.
    const resolved = await resolveElectionRouteParam(db, id);
    if (!resolved.ok) {
      const invalid = resolved.reason === "invalid_id";
      return NextResponse.json(
        { error: invalid ? "Invalid election id" : "Election not found" },
        { status: invalid ? 400 : 404 }
      );
    }

    const items = await getRaceWireFeed(db, {
      electionId: resolved.election._id.toString(),
      campaignId: parsed.data.campaignId,
      limit: parsed.data.limit ?? RACE_WIRE_DEFAULT_LIMIT,
    });

    // A race with no traffic yet is an empty strip, not a 404 — the ticker
    // simply renders nothing.
    return NextResponse.json({ items });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/elections/[id]/wire" });
  }
}
