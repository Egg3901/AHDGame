import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { Corporation, GameConfig } from "@/lib/db/types";
import { loadOpenOffers } from "@/lib/corporations/supplyExchange/listingView";

const MAX_OFFERS = 60;
const privateHeaders = { "Cache-Control": "private, no-store" };
const querySchema = z.object({
  commodity: z.enum(COMMODITY_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_OFFERS).default(MAX_OFFERS),
});

/**
 * GET /api/supply-offers?commodity=&page=&pageSize=: open standing offers plus
 * the corporations the viewer can take them with. Omit `commodity` to list
 * every commodity (the market hub). Read only; taking an offer goes through
 * the corporation's own take route.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const params = new URL(request.url).searchParams;
    const query = querySchema.safeParse({
      commodity: params.get("commodity") ?? undefined,
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? undefined,
    });
    if (!query.success) return errorResponse(400, "Invalid commodity or paging");
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { supplyAgreementsEnabled: 1 } });
    if (!config?.supplyAgreementsEnabled) {
      return NextResponse.json(
        {
          enabled: false,
          offers: [],
          myCorporations: [],
          currentTurn: 0,
          page: 1,
          hasMore: false,
          total: 0,
        },
        { headers: privateHeaders }
      );
    }
    const [turn, mine] = await Promise.all([
      getCurrentTurn(db),
      ObjectId.isValid(auth.user.userId)
        ? db
            .collection<Corporation>("corporations")
            .find({ userId: new ObjectId(auth.user.userId), ceoVacant: { $ne: true } })
            .project<Pick<Corporation, "_id" | "name" | "countryId">>({
              name: 1,
              countryId: 1,
            })
            .limit(20)
            .toArray()
        : Promise.resolve([]),
    ]);
    const [{ offers, hasMore }, total] = await Promise.all([
      loadOpenOffers(db, {
        commodity: query.data.commodity,
        turn,
        viewerCorpIds: new Set(mine.map((c) => c._id.toString())),
        limit: query.data.pageSize,
        page: query.data.page,
      }),
      db.collection("supplyListings").countDocuments({
        ...(query.data.commodity ? { commodity: query.data.commodity } : {}),
        expiresAtTurn: { $gt: turn },
      }),
    ]);
    return NextResponse.json(
      {
        enabled: true,
        offers,
        myCorporations: mine.map((c) => ({
          id: c._id.toString(),
          name: c.name,
          countryId: c.countryId,
        })),
        currentTurn: turn,
        page: query.data.page,
        hasMore,
        total,
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
