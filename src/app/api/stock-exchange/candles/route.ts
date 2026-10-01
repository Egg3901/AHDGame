import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState, MarketCapHistory, Corporation } from "@/lib/db/types";
import type { MarketIndexIntraday } from "@/lib/db/types/marketIndexIntraday";
import type { ShareTradeHistory, ShareTradeKind } from "@/lib/db/types/shareTradeHistory";
import { EXCHANGE_API_KEYS, getCountryForExchange } from "@/lib/constants/exchangeRegistry";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { gameDateAnchorFromState } from "@/lib/utils/gameDate";
import { conditionalJson } from "@/lib/api/conditionalJson";
import {
  buildCandles,
  bucketCandles,
  chartBucketTurns,
  type CandleInput,
} from "@/lib/stockExchange/candles";

// Game-calendar ranges plus older client ranges retained for compatibility.
const VALID_TURNS = new Set([4, 12, 24, 48, 168, 240, 480, 720, 8760, 0]);
const TURNOVER_KINDS: ShareTradeKind[] = [
  "market_buy",
  "market_sell",
  "limit_fill",
  "peer_fill",
  "listing_fill",
  "takeover_buyout",
];

/** Raw listed capitalization in anchor units. No simulated high/low values. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const exchange = searchParams.get("exchange")?.toLowerCase() ?? "global";
    const turns = Number(searchParams.get("turns") ?? 48);
    const sector = searchParams.get("sector") as CorporationType | null;
    if (
      !EXCHANGE_API_KEYS.has(exchange) ||
      !VALID_TURNS.has(turns) ||
      (sector != null && (exchange !== "global" || !Object.hasOwn(CORPORATION_TYPE_LABELS, sector)))
    ) {
      return NextResponse.json(
        { error: "Invalid exchange, game-calendar range or global sector." },
        { status: 400 }
      );
    }
    const authUser = await getAuthUser();
    const venueCountry = getCountryForExchange(exchange);
    if (
      !authUser?.isAdmin &&
      venueCountry &&
      !(await getEnabledCountryIds()).includes(venueCountry as CountryId)
    ) {
      return NextResponse.json({ exchange, turns, bucketed: false, points: [] });
    }
    const db = await getDb();
    const collection = db.collection<MarketCapHistory>("marketCapHistory");
    const [latest, gameState] = await Promise.all([
      collection.findOne({}, { sort: { turn: -1 }, projection: { turn: 1 } }),
      db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            currentTurn: 1,
            lastTurnProcessed: 1,
            startingYear: 1,
            preIterationTurns: 1,
            preIteration: 1,
          },
        }
      ),
    ]);
    if (!latest) return NextResponse.json({ exchange, turns, bucketed: false, points: [] });
    const lastTurn = Math.max(latest.turn, gameState?.currentTurn ?? latest.turn);
    const firstTurn = turns === 0 ? 1 : Math.max(1, lastTurn - turns + 1);
    const [history, previous, intradayRows] = await Promise.all([
      collection
        .find({ turn: { $gte: firstTurn, $lte: lastTurn } })
        .project<MarketCapHistory>({
          turn: 1,
          createdAt: 1,
          globalMarketCap: 1,
          nyseMarketCap: 1,
          ftseMarketCap: 1,
          exchangeCaps: 1,
          bySector: 1,
          listingUniverse: 1,
          removedMarketCap: 1,
        })
        .sort({ turn: 1 })
        .toArray(),
      collection.findOne({ turn: { $lt: firstTurn } }, { sort: { turn: -1 } }),
      db
        .collection<MarketIndexIntraday>("marketIndexIntraday")
        .find({
          exchange: sector ? `sector:${sector}` : exchange,
          turn: { $gte: Math.max(1, firstTurn - 1), $lte: lastTurn },
        })
        .project<MarketIndexIntraday>({
          turn: 1,
          open: 1,
          last: 1,
          high: 1,
          low: 1,
          prints: 1,
          updatedAt: 1,
        })
        .sort({ turn: 1 })
        .toArray(),
    ]);
    const capFor = (h: MarketCapHistory): number =>
      sector
        ? (h.bySector?.[sector] ?? 0)
        : exchange === "global"
          ? h.globalMarketCap
          : (h.exchangeCaps?.[exchange]?.marketCap ??
            (exchange === "nyse" ? h.nyseMarketCap : exchange === "ftse" ? h.ftseMarketCap : 0));
    const intraday = new Map(intradayRows.map((r) => [r.turn, r]));
    // Scope before grouping so other venues cannot consume the limit or poison the sum.
    const corps =
      venueCountry || sector
        ? await db
            .collection<Corporation>("corporations")
            .find({
              ...(venueCountry ? { countryId: venueCountry } : {}),
              ...(sector ? { type: sector } : {}),
            })
            .project({ _id: 1 })
            .toArray()
        : null;
    const finiteTotal = {
      $and: [
        { $isNumber: "$totalAnchor" },
        { $gte: ["$totalAnchor", 0] },
        { $lte: ["$totalAnchor", Number.MAX_VALUE] },
      ],
    };
    const turnover = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .aggregate<{ _id: number; volume: number; invalidTrades: number }>([
        {
          $match: {
            turn: { $gte: firstTurn, $lte: lastTurn },
            kind: { $in: TURNOVER_KINDS },
            shares: { $gt: 0 },
            ...(corps ? { corporationId: { $in: corps.map((c) => c._id) } } : {}),
          },
        },
        {
          $group: {
            _id: "$turn",
            volume: { $sum: { $cond: [finiteTotal, "$totalAnchor", 0] } },
            invalidTrades: { $sum: { $cond: [finiteTotal, 0, 1] } },
          },
        },
      ])
      .toArray();
    const actions = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .aggregate<{ _id: { turn: number; kind: string }; count: number }>([
        {
          $match: {
            turn: { $gte: firstTurn, $lte: lastTurn },
            kind: { $in: ["stock_split", "reverse_split"] },
            ...(corps ? { corporationId: { $in: corps.map((c) => c._id) } } : {}),
          },
        },
        { $group: { _id: { turn: "$turn", kind: "$kind" }, count: { $sum: 1 } } },
      ])
      .toArray();
    const actionsByTurn = new Map<number, string[]>();
    for (const action of actions) {
      const notes = actionsByTurn.get(action._id.turn) ?? [];
      notes.push(
        `${action.count} ${action._id.kind === "stock_split" ? "stock split" : "reverse split"} events recorded`
      );
      actionsByTurn.set(action._id.turn, notes);
    }
    const volumes = new Map(turnover.map((r) => [r._id, r]));
    const inputs: CandleInput[] = [];
    let prior: MarketCapHistory | null = previous;
    let invalidPriceTurns = 0;
    for (const h of history) {
      const cap = capFor(h);
      const time = Math.floor(new Date(h.createdAt).getTime() / 1000);
      if (!Number.isFinite(cap) || cap < 0 || !Number.isFinite(time)) {
        invalidPriceTurns++;
        continue;
      }
      const notes: string[] = [...(actionsByTurn.get(h.turn) ?? [])];
      if (prior && prior.turn + 1 !== h.turn)
        notes.push(`Missing turn history between T${prior.turn} and T${h.turn}`);
      if (prior && prior.listingUniverse !== h.listingUniverse)
        notes.push("Listing coverage changed; capitalization levels are not directly comparable");
      const removed =
        exchange === "global" ? h.removedMarketCap : h.exchangeCaps?.[exchange]?.removedMarketCap;
      if (!sector && removed && removed > 0)
        notes.push("Listed constituents removed; total capitalization includes the removal");
      if (prior && capFor(prior) > 0 && Math.abs(cap / capFor(prior) - 1) >= 0.5)
        notes.push("Large recorded valuation change; not a verified investment return");
      inputs.push({
        turn: h.turn,
        time,
        cap: Math.round(cap),
        volume: volumes.get(h.turn)?.volume ?? 0,
        invalidVolumeTrades: volumes.get(h.turn)?.invalidTrades ?? 0,
        notes,
      });
      prior = h;
    }
    // A refreshed live print can precede the next end-of-turn history row.
    for (const row of intradayRows) {
      if (
        row.turn <= (inputs.at(-1)?.turn ?? latest.turn) ||
        row.turn < firstTurn ||
        !Number.isFinite(row.last)
      )
        continue;
      inputs.push({
        turn: row.turn,
        time: Math.floor(new Date(row.updatedAt).getTime() / 1000),
        cap: row.last,
        volume: volumes.get(row.turn)?.volume ?? 0,
        invalidVolumeTrades: volumes.get(row.turn)?.invalidTrades ?? 0,
      });
    }
    const raw = buildCandles(
      inputs,
      intraday,
      previous && Number.isFinite(capFor(previous))
        ? {
            turn: previous.turn,
            time: Math.floor(new Date(previous.createdAt).getTime() / 1000),
            cap: capFor(previous),
            volume: 0,
          }
        : undefined
    );
    const bucketTurns = chartBucketTurns(turns, lastTurn - firstTurn + 1);
    const points = bucketCandles(raw, bucketTurns);
    const calendar = gameState ? gameDateAnchorFromState(gameState) : null;
    const asOf = intradayRows.at(-1)?.updatedAt ?? history.at(-1)?.createdAt ?? null;
    return conditionalJson(request, {
      exchange,
      sector,
      turns,
      metric: "raw-market-cap",
      bucketed: bucketTurns > 1,
      bucketTurns,
      points,
      intradayTurns: raw.filter((c) => c.intraday).length,
      totalTurns: raw.length,
      firstIntradayTurn: raw.find((c) => c.intraday)?.turn ?? null,
      calendar,
      asOf,
      latestTurn: points.at(-1)?.endTurn ?? null,
      missingTurns: inputs.length ? lastTurn - inputs[0].turn + 1 - inputs.length : 0,
      invalidPriceTurns,
      invalidVolumeTrades: turnover.reduce((sum, r) => sum + r.invalidTrades, 0),
      volumeCoverage: "Recorded executable fills; invalid records excluded and flagged",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
