// POST /api/country/[code]/national-corporation/[id]/privatize
// Treasury-gated (finance minister, fallback head of government) privatization:
// carve a new private corp out of this National Corporation and float it (IPO).
// Auth: requireAuthWithCharacter + assertTreasuryAuthority. Spec §13.
// Errors: 400, 401, 403, 404, 429
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, isUnexpectedError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { privatizeAsset } from "@/lib/nationalization/privatizeAsset";
import { executivePrivatizeSchema } from "@/lib/api/schemas/nationalization";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import { generateStockExchangeSnapshots } from "@/lib/turn/stockExchangeSnapshot";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const idQuery = corporationQueryFromParamId(id);
    if (!idQuery) {
      return NextResponse.json({ error: "Invalid corporation ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, executivePrivatizeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    for (const sel of parsed.data.selections) {
      if (!ObjectId.isValid(sel.sectorId)) {
        return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
      }
    }

    const db = await getDb();

    // Authority: seated finance minister, or head of government if vacant.
    const authorized = await assertTreasuryAuthority(db, countryId, auth.user.character._id);
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "Only the Secretary of the Treasury (or equivalent), or the head of government if that seat is vacant, may privatize a National Corporation asset.",
        },
        { status: 403 }
      );
    }

    const source = await db
      .collection<Corporation>("corporations")
      .findOne({ ...idQuery, countryOwnerId: countryId });
    if (!source || !isStateOwned(source)) {
      return NextResponse.json(
        { error: "National Corporation not found for this country." },
        { status: 404 }
      );
    }

    const turn = await getCurrentTurn(db);
    try {
      const result = await privatizeAsset(db, {
        countryId,
        sourceNationalCorporationId: source._id,
        selections: parsed.data.selections.map((s) => ({
          sectorId: new ObjectId(s.sectorId),
          carveFraction: s.carveFraction,
        })),
        newCorpName: parsed.data.newCorpName,
        goldenSharePercent: parsed.data.goldenSharePercent,
        method: parsed.data.method,
        reservePrice: parsed.data.reservePrice,
        headquartersState: parsed.data.headquartersState,
        turn,
      });
      // The completion wire is emitted by the engine at the moment a privatization
      // actually completes (IPO in privatizeAsset; auction at sale in the resolver),
      // so the route does not log here — an auction merely OPENS at this point.

      // An IPO floats a tradable corp immediately. Rebuild the stock-exchange
      // snapshot now so it appears on the Stock Market without waiting for the
      // 15-min cron — otherwise only the privatizer knows it exists and could
      // trade ahead of everyone else. Auctions list at sale (turn resolver), so
      // they're skipped here. A snapshot hiccup must not fail the privatization.
      if (parsed.data.method === "ipo") {
        try {
          await generateStockExchangeSnapshots(turn, db);
        } catch (snapErr) {
          console.error("[privatize] stock-exchange snapshot refresh failed:", snapErr);
        }
      }

      return NextResponse.json({
        success: true,
        ...result,
        newCorporationId: result.newCorporationId.toString(),
      });
    } catch (err) {
      // Engine validation failures (name taken, cooldown, bad sector) → 400,
      // but genuine infra/programming faults must be captured, not masked.
      if (isUnexpectedError(err)) {
        return handleRouteError(err, {
          request,
          route: "/api/country/[code]/national-corporation/[id]/privatize",
        });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Privatization failed" },
        { status: 400 }
      );
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
