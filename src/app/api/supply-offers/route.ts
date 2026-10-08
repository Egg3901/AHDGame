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

const privateHeaders = { "Cache-Control": "private, no-store" };
const querySchema = z.object({ commodity: z.enum(COMMODITY_TYPES) });
const MAX_OFFERS = 60;

/**
 * GET /api/supply-offers?commodity=: open standing offers for one commodity
 * plus the corporations the viewer can take them with. Read only; taking an
 * offer goes through the corporation's own take route.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const query = querySchema.safeParse({
      commodity: new URL(request.url).searchParams.get("commodity") ?? undefined,
    });
    if (!query.success) return errorResponse(400, "Valid commodity required");
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { supplyAgreementsEnabled: 1 } });
    if (!config?.supplyAgreementsEnabled) {
      return NextResponse.json(
        { enabled: false, offers: [], myCorporations: [], currentTurn: 0 },
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
    const offers = await loadOpenOffers(db, {
      commodity: query.data.commodity,
      turn,
      viewerCorpIds: new Set(mine.map((c) => c._id.toString())),
      limit: MAX_OFFERS,
    });
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
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
