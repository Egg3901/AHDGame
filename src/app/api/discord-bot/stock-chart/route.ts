import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import type { Corporation, CorporationHistory, MarketCapHistory } from "@/lib/db/types";
import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";

// GET /api/discord-bot/stock-chart — Returns historical share price or aggregate market-cap data for a corporation or exchange.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:stock-chart",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const corpName = url.searchParams.get("corp");
    const country = url.searchParams.get("country")?.toLowerCase();
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10)), 500);

    const db = await getDb();

    // --- Per-corporation mode ---
    if (corpName) {
      const escapedName = corpName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const corporation = await db
        .collection<Corporation>("corporations")
        .findOne({ name: { $regex: new RegExp(`^${escapedName}$`, "i") } });

      if (!corporation) {
        return NextResponse.json({ found: false });
      }

      const history = await db
        .collection<CorporationHistory>("corporationHistory")
        .find({ corporationId: corporation._id })
        .sort({ turn: -1 })
        .limit(limit)
        .project<
          Pick<
            CorporationHistory,
            "turn" | "sharePrice" | "marketCap" | "revenue" | "income" | "createdAt"
          >
        >({
          _id: 0,
          turn: 1,
          sharePrice: 1,
          marketCap: 1,
          revenue: 1,
          income: 1,
          createdAt: 1,
        })
        .toArray();

      history.reverse();

      return NextResponse.json({
        found: true,
        mode: "corporation",
        corporation: {
          name: corporation.name,
          sequentialId: corporation.sequentialId,
          type: corporation.type,
          countryId: corporation.countryId,
        },
        points: history.map((h) => ({
          turn: h.turn,
          sharePrice: h.sharePrice,
          marketCap: h.marketCap,
          revenue: h.revenue,
          income: h.income,
          timestamp: h.createdAt,
        })),
      });
    }

    // --- Market-wide mode (default) ---
    if (country && !getExchangeApiKey(country.toUpperCase())) {
      return NextResponse.json(
        {
          error: "Invalid country. Use a valid country code (us, uk, jp, etc.) or omit for global.",
        },
        { status: 400 }
      );
    }

    const history = await db
      .collection<MarketCapHistory>("marketCapHistory")
      .find({})
      .sort({ turn: -1 })
      .limit(limit)
      .toArray();

    history.reverse();

    const exchange = country ? (getExchangeApiKey(country.toUpperCase()) ?? "global") : "global";

    return NextResponse.json({
      found: true,
      mode: "market",
      exchange,
      points: history.map((h) => {
        let marketCap: number;
        if (exchange === "global") {
          marketCap = h.globalMarketCap;
        } else {
          const exData = h.exchangeCaps?.[exchange];
          if (exData) {
            marketCap = exData.marketCap;
          } else {
            // Legacy fallback
            const LEGACY: Record<string, number> = {
              nyse: h.nyseMarketCap,
              ftse: h.ftseMarketCap,
            };
            marketCap = LEGACY[exchange] ?? h.globalMarketCap;
          }
        }

        return {
          turn: h.turn,
          marketCap,
          bySector: h.bySector,
          timestamp: h.createdAt,
        };
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
