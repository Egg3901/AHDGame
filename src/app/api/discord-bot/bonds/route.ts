import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { Bond, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { getGameState } from "@/lib/gameState";
import { ObjectId } from "mongodb";
import { corpCapitalToAnchor, loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { calculateBondYieldToMaturityPercent } from "@/lib/constants/bonds";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

// GET /api/discord-bot/bonds — Lists active (non-matured) corporate bonds, with optional filtering by corporation name.
// Auth: requireAdminOrApiKey
// Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:bonds",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const enabledCountries = await getEnabledCountryIds();

    const url = new URL(request.url);
    const corpName = url.searchParams.get("corp");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const perPage = 10;

    const db = await getDb();
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    // Optionally filter by corporation name
    let corpFilter: { corporationId?: ObjectId } = {};
    let filterCorpName: string | null = null;
    if (corpName) {
      const escapedName = corpName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ name: { $regex: new RegExp(`^${escapedName}$`, "i") } });
      if (!corp) {
        return NextResponse.json({ found: false, bonds: [] });
      }
      corpFilter = { corporationId: corp._id };
      filterCorpName = corp.name;
    }

    // Only show bonds from enabled countries (bonds without countryId are treated as legacy/global)
    const countryFilter = {
      $or: [{ countryId: { $in: enabledCountries } }, { countryId: { $exists: false } }],
    };

    const totalCount = await db
      .collection<Bond>("bonds")
      .countDocuments({ matured: false, ...corpFilter, ...countryFilter });

    const bonds = await db
      .collection<Bond>("bonds")
      .find({ matured: false, ...corpFilter, ...countryFilter })
      .sort({ createdAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .toArray();

    // Resolve corporation names
    const corpIds = [...new Set(bonds.map((b) => b.corporationId.toString()))];
    const corporations = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } })
      .project<{
        _id: ObjectId;
        name: string;
        sequentialId?: number;
        brandColor?: string;
        countryId?: string;
      }>({ _id: 1, name: 1, sequentialId: 1, brandColor: 1, countryId: 1 })
      .toArray();
    const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));

    // Each bond's `totalIssued` is LOCAL in `bond.currencyCode` (Task-18B);
    // the pre-A29 raw sum across bonds mixed currencies silently (USD + GBP
    // + JPY). Anchor-normalize per-bond so `totalOutstandingDebt` is ₳. Each
    // listing row additionally ships its own `currencyCode` so the discord
    // bot can label per-bond face values with the right symbol.
    const fxByCurrency = await loadFxRatesByCurrency(db);
    let totalOutstandingDebtAnchor = 0;

    const bondListings = bonds.map((bond) => {
      const corp = corpMap.get(bond.corporationId.toString());
      const turnsRemaining = Math.max(0, bond.maturityTurn - currentTurn);
      const totalUnits = Math.floor(bond.totalIssued / BOND_UNIT_FACE_VALUE);
      const bondCcy = (bond.currencyCode ??
        (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      totalOutstandingDebtAnchor += corpCapitalToAnchor(bond.totalIssued, bondCcy, bondFxRate);
      const yieldToMaturity =
        Math.round(
          calculateBondYieldToMaturityPercent(bond.couponRate, bond.marketPrice, turnsRemaining) *
            100
        ) / 100;

      return {
        id: bond._id.toString(),
        bondUrl: `${BASE_URL}/bond/${bond._id}`,
        corporationName: corp?.name ?? "Unknown",
        corporationId: corp?.sequentialId ?? bond.corporationId.toString(),
        brandColor: corp?.brandColor ?? null,
        countryId: corp?.countryId ?? null,
        currencyCode: bondCcy ?? null,
        couponRate: bond.couponRate,
        maturityLabel:
          BOND_MATURITY_LABELS[bond.maturityTurns as BondMaturityTurns] ??
          `${bond.maturityTurns} turns`,
        totalIssued: bond.totalIssued,
        totalUnits,
        publicFloat: bond.publicFloat,
        marketPrice: bond.marketPrice,
        turnsRemaining,
        yieldToMaturity,
        defaulted: bond.defaulted,
        holders: bond.holders.length,
      };
    });

    return NextResponse.json({
      found: true,
      filterCorp: filterCorpName,
      bonds: bondListings,
      totalOutstandingDebt: totalOutstandingDebtAnchor,
      pagination: {
        page,
        perPage,
        totalCount,
        totalPages: Math.ceil(totalCount / perPage),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
