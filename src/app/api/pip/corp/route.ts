// GET /api/pip/corp — Returns the player's corporation stats, commodity spot prices, and top corps.
// Auth: public; auth enriches playerCorp
// Errors: none
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import type {
  Character,
  CommodityPrice,
  CommodityPriceHistory,
  Corporation,
  CorporateSector,
} from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  fxRateForCorpFromMap,
  loadValuationFxRates,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";
import type { CurrencyCode } from "@/lib/constants/currencies";

// The six commodity types shown in the PiP Corp view
const PIP_COMMODITIES: CommodityType[] = [
  "oil",
  "steel",
  "electronics",
  "energy",
  "food",
  "chemicals",
];
// Validate all are in COMMODITY_TYPES at module load (type-safe via CommodityType union)
void COMMODITY_TYPES;

export async function GET() {
  try {
    const db = await getDb();
    const authUser = await getAuthUser();

    let character: Character | null = null;
    if (authUser) {
      character = await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(authUser.userId) });
    }

    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    // Fetch commodity current prices + previous turn prices + top corps in parallel
    const [currentPrices, prevPrices, topCorpDocs] = await Promise.all([
      db
        .collection<CommodityPrice>("commodityPrices")
        .find({ commodity: { $in: PIP_COMMODITIES } })
        .toArray(),
      db
        .collection<CommodityPriceHistory>("commodityPriceHistory")
        .find({ commodity: { $in: PIP_COMMODITIES }, turn: currentTurn - 1 })
        .project({ commodity: 1, globalPrice: 1 })
        .toArray() as Promise<{ commodity: CommodityType; globalPrice: number }[]>,
      db
        .collection<Corporation>("corporations")
        .find({
          ceoVacant: { $ne: true },
          ...(enabledCountries !== undefined && { countryId: { $in: enabledCountries } }),
        })
        .toArray(),
    ]);

    // Aggregate revenue for each corp from corporateSectors — ranking spans
    // corps with heterogeneous liquidCurrencyCode (v0.2.6), so sum in ₳.
    const topCorpIds = topCorpDocs.map((c) => c._id);
    const [allSectors, fxByCurrency] = await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: { $in: topCorpIds } })
        .project<{ corporationId: ObjectId; revenue: number; realizedRevenue?: number }>({
          corporationId: 1,
          revenue: 1,
          // Without this `sectorEconomicRevenue` silently degrades to nameplate.
          realizedRevenue: 1,
        })
        .toArray(),
      // Valuation map, not the settlement map: this RANKS corps for display, and
      // the settlement map converts the six bloc currencies at 1.0. See
      // corporationCapital.ts.
      loadValuationFxRates(db),
    ]);

    const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
    for (const c of topCorpDocs) {
      fxByCorpId.set(c._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(c),
        rate: fxRateForCorpFromMap(c, fxByCurrency),
      });
    }

    const revenueAnchorMap = new Map<string, number>();
    for (const sector of allSectors) {
      const key = sector.corporationId.toString();
      const fx = fxByCorpId.get(key);
      const revenueAnchor = readCorpEconomicAnchor(
        sectorEconomicRevenue(sector),
        fx?.code,
        fx?.rate ?? 1
      );
      revenueAnchorMap.set(key, (revenueAnchorMap.get(key) ?? 0) + revenueAnchor);
    }

    // Sort by anchor revenue and take top 5
    const topCorpsSorted = topCorpDocs
      .map((c) => ({ corp: c, revenueAnchor: revenueAnchorMap.get(c._id.toString()) ?? 0 }))
      .sort((a, b) => b.revenueAnchor - a.revenueAnchor)
      .slice(0, 5);

    // Build commodity response
    const prevPriceMap = new Map(prevPrices.map((p) => [p.commodity, p.globalPrice]));
    const commodities = PIP_COMMODITIES.map((type) => {
      const current = currentPrices.find((p) => p.commodity === type);
      const prevPrice = prevPriceMap.get(type) ?? current?.globalPrice ?? 0;
      const price = current?.globalPrice ?? 0;
      const change24h =
        prevPrice > 0 ? Math.round(((price - prevPrice) / prevPrice) * 10000) / 100 : 0;
      return { type, price, change24h };
    });

    // Player corp (auth only)
    let playerCorp = null;
    if (character) {
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });

      if (corp) {
        const sectors = await db
          .collection<CorporateSector>("corporateSectors")
          .find({ corporationId: corp._id })
          .project<Pick<CorporateSector, "revenue" | "realizedRevenue">>({
            revenue: 1,
            // Without this `sectorEconomicRevenue` silently degrades to nameplate.
            realizedRevenue: 1,
          })
          .toArray();

        // Realized, not nameplate - the same basis the corporation page, the
        // stock list, the public API and the Discord cards use. See
        // lib/corporations/sectorRevenueBasis.
        const revenuePerTurn = sectors.reduce((sum, s) => sum + sectorEconomicRevenue(s), 0);

        playerCorp = {
          id: corp._id.toString(),
          name: corp.name,
          type: corp.type,
          revenuePerTurn,
          liquidCurrencyCode: corp.liquidCurrencyCode ?? null,
        };
      }
    }

    // revenuePerTurn on topCorps is anchor — row currencies differ across the
    // ranking, so a single comparable figure is required.
    const topCorps = topCorpsSorted.map(({ corp, revenueAnchor }, i) => ({
      id: corp._id.toString(),
      name: corp.name,
      revenuePerTurn: revenueAnchor,
      rank: i + 1,
      isPlayerCorp: playerCorp ? corp._id.toString() === playerCorp.id : false,
    }));

    return NextResponse.json(
      { playerCorp, commodities, topCorps },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
