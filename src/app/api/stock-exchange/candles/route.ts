import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import type { MarketCapHistory } from "@/lib/db/types";
import type { MarketIndexIntraday } from "@/lib/db/types/marketIndexIntraday";
import type { ShareTradeHistory, ShareTradeKind } from "@/lib/db/types/shareTradeHistory";
import type { Corporation } from "@/lib/db/types";
import { EXCHANGE_API_KEYS, getCountryForExchange } from "@/lib/constants/exchangeRegistry";
import { conditionalJson } from "@/lib/api/conditionalJson";
import {
  buildCandles,
  bucketWeekly,
  WEEK_TURNS,
  type CandleInput,
} from "@/lib/stockExchange/candles";

/** Ranges the chart offers, in turns (0 = all available history). */
const VALID_TURNS = new Set([24, 168, 720, 8760, 0]);
const HISTORY_CAP = 2000;

/** Trade kinds that count as market turnover for the volume subplot. */
const TURNOVER_KINDS: ShareTradeKind[] = [
  "market_buy",
  "market_sell",
  "limit_fill",
  "peer_fill",
  "listing_fill",
  "takeover_buyout",
];

/**
 * GET /api/stock-exchange/candles?exchange=global|nyse|...&turns=24|168|720|8760|0
 * Per-turn OHLC candles from raw anchor market cap plus aggregate turnover.
 * High/low prefer observed intraday extremes (marketIndexIntraday, written on
 * every snapshot rebuild); turns without prints fall back to open/close.
 * Long ranges (1Y/ALL) arrive in 168-turn weekly buckets.
 */
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const exchange = searchParams.get("exchange")?.toLowerCase() ?? "global";
    const turns = Number(searchParams.get("turns") ?? 168);

    if (!EXCHANGE_API_KEYS.has(exchange)) {
      return NextResponse.json(
        { error: `Invalid exchange. Use one of: ${[...EXCHANGE_API_KEYS].join(", ")}` },
        { status: 400 }
      );
    }
    if (!VALID_TURNS.has(turns)) {
      return NextResponse.json(
        { error: "Invalid turns. Use one of: 24, 168, 720, 8760, 0." },
        { status: 400 }
      );
    }

    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const venueCountry = getCountryForExchange(exchange);
    if (!isAdmin && venueCountry) {
      const enabledCountries = await getEnabledCountryIds();
      if (!enabledCountries.includes(venueCountry as CountryId)) {
        return NextResponse.json({ exchange, turns, bucketed: false, points: [] });
      }
    }

    const history = await db
      .collection<MarketCapHistory>("marketCapHistory")
      .find({})
      .sort({ turn: -1 })
      .limit(turns === 0 ? HISTORY_CAP : turns)
      .toArray();
    history.reverse();
    if (history.length === 0) {
      return NextResponse.json({ exchange, turns, bucketed: false, points: [] });
    }
    const firstTurn = history[0].turn;
    const lastTurn = history[history.length - 1].turn;

    const capFor = (h: MarketCapHistory): number => {
      if (exchange === "global") return h.globalMarketCap;
      const exData = h.exchangeCaps?.[exchange];
      if (exData) return exData.marketCap;
      if (exchange === "nyse") return h.nyseMarketCap ?? 0;
      if (exchange === "ftse") return h.ftseMarketCap ?? 0;
      return 0;
    };

    // Observed intraday extremes for the range (empty until the writer has
    // recorded prints; candles fall back to open/close meanwhile).
    const intradayRows = await db
      .collection<MarketIndexIntraday>("marketIndexIntraday")
      .find({ exchange, turn: { $gte: firstTurn, $lte: lastTurn } })
      .project({ turn: 1, high: 1, low: 1, prints: 1 })
      .toArray();
    const intraday = new Map(
      intradayRows.map((r) => [r.turn, { high: r.high, low: r.low, prints: r.prints }])
    );

    // Per-turn turnover from share fills. Venue views scope to that venue's
    // corporations via a lightweight id-to-country map; global skips the join.
    let venueCorpIds: Set<string> | null = null;
    if (venueCountry) {
      const corps = await db
        .collection<Corporation>("corporations")
        .find({})
        .project({ countryId: 1 })
        .toArray();
      venueCorpIds = new Set(
        corps.filter((c) => c.countryId === venueCountry).map((c) => c._id.toString())
      );
    }
    const turnoverRows = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .aggregate<{ _id: number; volume: number }>([
        {
          $match: {
            turn: { $gte: firstTurn, $lte: lastTurn },
            kind: { $in: TURNOVER_KINDS },
          },
        },
        { $group: { _id: "$turn", volume: { $sum: "$totalAnchor" } } },
      ])
      .toArray();
    // Venue scoping needs per-corp attribution, which the turn-grouped rollup
    // discards; run the corp-scoped variant only for venue views.
    let volumeByTurn = new Map(turnoverRows.map((r) => [r._id, Math.round(r.volume)]));
    if (venueCorpIds) {
      const venueRows = await db
        .collection<ShareTradeHistory>("shareTradeHistory")
        .aggregate<{ _id: { turn: number; corp: unknown }; volume: number }>([
          {
            $match: {
              turn: { $gte: firstTurn, $lte: lastTurn },
              kind: { $in: TURNOVER_KINDS },
            },
          },
          {
            $group: {
              _id: { turn: "$turn", corp: "$corporationId" },
              volume: { $sum: "$totalAnchor" },
            },
          },
        ])
        .toArray();
      volumeByTurn = new Map<number, number>();
      for (const r of venueRows) {
        const corpId = String(r._id.corp ?? "");
        if (!venueCorpIds.has(corpId)) continue;
        volumeByTurn.set(r._id.turn, Math.round((volumeByTurn.get(r._id.turn) ?? 0) + r.volume));
      }
    }

    const inputs: CandleInput[] = history.map((h) => ({
      turn: h.turn,
      time: Math.floor(new Date(h.createdAt).getTime() / 1000),
      cap: Math.round(capFor(h)),
      volume: volumeByTurn.get(h.turn) ?? 0,
    }));
    let candles = buildCandles(inputs, intraday);
    // 1Y/ALL aggregate into weekly buckets so series stay small.
    const bucketed = turns === 8760 || turns === 0;
    if (bucketed) candles = bucketWeekly(candles);

    const intradayTurns = candles.filter((c) => c.intraday).length;
    return conditionalJson(request, {
      exchange,
      turns,
      bucketed,
      bucketTurns: bucketed ? WEEK_TURNS : 1,
      points: candles,
      intradayTurns,
      totalTurns: candles.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
