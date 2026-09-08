import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { targetKey, purchaseSchema, quoteCountSchema } from "@/lib/campaignTargeting/schema";
import { parseJsonBody } from "@/lib/api/validate";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getDb } from "@/lib/mongodb";
import type { State, Character, NPP } from "@/lib/db/types";
import {
  loadTargetedAdContext,
  purchaseTargetedAds,
  quoteTargetedAds,
} from "@/lib/campaignTargeting/commands";

type Params = { params: Promise<{ id: string }> };

// GET /api/campaigns/[id]/targeted-ads: private regional ad quote for managers/nominee.
// Auth: requireAuthWithCharacter; errors: 400, 401, 403, 404.
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const previewRate = checkRateLimit(`targeted-ads-preview:${auth.user.userId}`, 30, 60_000);
    if (!previewRate.ok) return rateLimitResponse(previewRate.retryAfter);
    const { id } = await params;
    const state = targetKey
      .optional()
      .safeParse(request.nextUrl.searchParams.get("stateId") ?? undefined);
    if (!ObjectId.isValid(id) || !state.success) throw badRequest("Invalid campaign or region");
    const db = await getDb();
    const context = await loadTargetedAdContext(db, new ObjectId(id), auth.user);
    const ownerHome =
      context.candidate.isNPP && context.candidate.nppId
        ? (
            await db
              .collection<NPP>("npps")
              .findOne({ _id: context.candidate.nppId }, { projection: { homeState: 1 } })
          )?.homeState
        : (
            await db
              .collection<Character>("characters")
              .findOne({ _id: context.candidate.characterId }, { projection: { homeState: 1 } })
          )?.homeState;
    const regions = await db
      .collection<State>("states")
      .find(
        {
          countryId: context.election.countryId,
          _id: ["president", "uachtaran"].includes(context.election.electionType)
            ? { $ne: context.election.countryId }
            : (ownerHome ?? context.election.state),
        },
        { projection: { _id: 1, name: 1 } }
      )
      .toArray();
    const stateId = state.data ?? ownerHome ?? regions[0]?._id;
    if (!stateId) throw badRequest("No regions available for this race");
    const count = quoteCountSchema.safeParse(request.nextUrl.searchParams.get("count") ?? 1);
    if (!count.success) throw badRequest("Invalid action count");
    const quote = await quoteTargetedAds(db, context, stateId, count.data);
    return NextResponse.json(
      {
        ...quote,
        regions:
          "regions" in quote
            ? quote.regions
            : regions.map((region) => ({ id: region._id, name: region.name })),
        stateId,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/campaigns/[id]/targeted-ads: buy an immediate regional bonus.
// Auth: requireAuthWithCharacter; errors: 400, 401, 403, 404, 409, 429.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const { id } = await params;
    const parsed = await parseJsonBody(request, purchaseSchema);
    if (!ObjectId.isValid(id)) throw badRequest("Invalid campaign");
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const result = await purchaseTargetedAds(
      await getDb(),
      new ObjectId(id),
      auth.user,
      parsed.data
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
