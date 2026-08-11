/**
 * POST /api/corporations/[id]/sectors/[sectorId]/list
 * List a sector on the secondary market at SECTOR_FOR_SALE_PRICE_FRACTION × NPV.
 * CEO only. Loss-making sectors (no positive base profit) cannot be listed.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { CorporateSector } from "@/lib/db/types";
import { getSectorHostFxRate } from "@/lib/currency/corporationCapital";
import { computeSectorListingValuation } from "@/lib/corporations/sectorValuation";
import { getGameState } from "@/lib/gameState";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

export async function listSectorForSale(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    if (sector.forSale) {
      return NextResponse.json({ error: "Sector is already listed for sale" }, { status: 400 });
    }

    const hostFxRate = await getSectorHostFxRate(db, sector, corporation);
    // Under plants the growth-cost deduction is vestigial — quoting with it
    // would understate every listing (and block listing sectors that are
    // genuinely profitable).
    const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
    // Book floor under plants: a mothballed (or merely unprofitable) sector still
    // holds real capacity and real construction in progress, and used to price at
    // 0 — which the guard below turned into "cannot be sold to anyone, ever",
    // leaving only abandon/dissolution, both of which pay less than book. The
    // floor is the same `sectorBookValueAnchor` those exits settle at, so there
    // is no arbitrage between selling and salvaging.
    const gameState = plantsEnabled ? await getGameState(db) : null;
    const valuation = computeSectorListingValuation(
      sector,
      corporation,
      hostFxRate,
      plantsEnabled,
      plantsEnabled
        ? {
            sector,
            currentYear: gameState?.currentYear,
            eraUnitScale: await loadWorldEraUnitScale(db),
          }
        : undefined
    );

    if (valuation.priceAnchor <= 0) {
      return NextResponse.json(
        {
          error: plantsEnabled
            ? "Cannot list a sector with no capacity and no profitability. Build capacity or improve base margin first."
            : "Cannot list a sector with no positive profitability. Improve base margin or reduce growth cost first.",
        },
        { status: 400 }
      );
    }

    const now = new Date();
    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: sector._id, corporationId: corporation._id },
      {
        $set: {
          forSale: {
            listedAt: now,
            priceAnchor: valuation.priceAnchor,
            npvAnchor: valuation.npvAnchor,
          },
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({
      success: true,
      priceAnchor: valuation.priceAnchor,
      npvAnchor: valuation.npvAnchor,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
