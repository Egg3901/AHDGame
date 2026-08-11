import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { TradeHistoryEntry, TradeSource } from "@/lib/db/types";

/**
 * GET /api/forex/transactions
 * Turn-bucketed forex activity feed for the Transactions tab.
 *
 * Response groups rows per turn so the UI can render a separator for each
 * turn tick. Inside each turn, auto-income conversions (dividends + bond
 * coupons) are aggregated across all players into summary rows — one per
 * (source, fromCurrency, toCurrency) — because "every player's coupon" is
 * noise; we just want the net market-making pressure. Non-aggregated rows
 * (manual, direct, limit_order, auto_purchase) are kept individual.
 *
 * Auth: requireAuthWithCharacter
 * Indexes used: tradeHistory (turn, createdAt)
 *
 * Query params:
 *   turns       number of recent turns to return (1..8, default 2)
 *   offset      skip the latest N turns, for pagination (default 0, max 8)
 *   source      optional filter: manual | direct | limit_order | auto_purchase |
 *               auto_income (= auto_dividend + auto_coupon)
 *   currency    optional filter — only trades that touched this currency
 *   scope       "all" (default) | "mine" — "mine" restricts individual rows
 *               to trades involving the authenticated character (summary
 *               aggregates are always global — they're what move rates)
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const turnsRequested = Math.min(
      8,
      Math.max(1, Number.parseInt(searchParams.get("turns") ?? "2", 10) || 2)
    );
    const offset = Math.min(
      8,
      Math.max(0, Number.parseInt(searchParams.get("offset") ?? "0", 10) || 0)
    );
    const sourceParam = searchParams.get("source");
    const currencyParam = searchParams.get("currency");
    const scope = searchParams.get("scope") ?? "all";

    const db = await getDb();
    const characterId = auth.user.character._id as ObjectId;

    // Resolve which turn numbers to include. Look back enough turns to cover
    // `offset + turnsRequested` distinct turns that actually have activity.
    const recentTurns = await db
      .collection<TradeHistoryEntry>("tradeHistory")
      .aggregate([
        { $group: { _id: "$turn" } },
        { $sort: { _id: -1 } },
        { $limit: offset + turnsRequested },
      ])
      .toArray();
    const windowTurns = recentTurns
      .map((r) => r._id as number)
      .slice(offset, offset + turnsRequested);

    if (windowTurns.length === 0) {
      return NextResponse.json({ turns: [], offset, turnsRequested, hasMore: false });
    }

    const baseMatch: Record<string, unknown> = { turn: { $in: windowTurns } };
    if (currencyParam) {
      baseMatch.$or = [{ fromCurrency: currencyParam }, { toCurrency: currencyParam }];
    }

    // Aggregate pipeline returns a mix of individual rows (non-auto-income) and
    // summary rows (auto_dividend + auto_coupon grouped by pair per turn).
    const AUTO_INCOME_SOURCES = ["auto_dividend", "auto_coupon"] as const;

    // In "mine" mode we want the user's own individual rows across every source
    // (including auto_dividend/auto_coupon) — aggregate summaries are a global
    // market-pressure view and make no sense when scoped to one player.
    const individualMatch: Record<string, unknown> = { ...baseMatch };
    if (scope === "mine") {
      individualMatch.$and = [
        { $or: [{ buyerCharacterId: characterId }, { sellerCharacterId: characterId }] },
      ];
    } else {
      // Public feed: keep auto-income out of the individual stream (they're
      // rolled up into summaries below).
      individualMatch.source = { $nin: AUTO_INCOME_SOURCES };
    }

    // Source filter applied only when user picked a specific non-auto-income filter
    if (sourceParam && sourceParam !== "auto_income") {
      individualMatch.source = sourceParam;
    } else if (sourceParam === "auto_income" && scope === "mine") {
      individualMatch.source = { $in: AUTO_INCOME_SOURCES };
    }

    // When the user filters to auto_income only in "all" mode, skip individuals.
    const wantIndividuals = !(sourceParam === "auto_income" && scope === "all");
    // Summaries are a public-market construct; don't build them when scope=mine.
    const wantAutoSummary =
      scope === "all" &&
      sourceParam !== "manual" &&
      sourceParam !== "direct" &&
      sourceParam !== "limit_order" &&
      sourceParam !== "auto_purchase";

    const [individualRows, autoSummaryRows] = await Promise.all([
      wantIndividuals
        ? db
            .collection<TradeHistoryEntry>("tradeHistory")
            .find(individualMatch)
            .sort({ turn: -1, createdAt: -1 })
            .toArray()
        : Promise.resolve([] as TradeHistoryEntry[]),
      wantAutoSummary
        ? db
            .collection<TradeHistoryEntry>("tradeHistory")
            .aggregate([
              { $match: { ...baseMatch, source: { $in: AUTO_INCOME_SOURCES } } },
              {
                $group: {
                  _id: {
                    turn: "$turn",
                    source: "$source",
                    fromCurrency: "$fromCurrency",
                    toCurrency: "$toCurrency",
                  },
                  totalAmount: { $sum: "$amount" },
                  totalSpread: { $sum: "$spread" },
                  avgRate: { $avg: "$rate" },
                  participantCount: { $sum: 1 },
                },
              },
              { $sort: { "_id.turn": -1, "_id.source": 1 } },
            ])
            .toArray()
        : Promise.resolve([] as Record<string, unknown>[]),
    ]);

    // Enrich individual rows with trader names (for public feed)
    const charRefIds = new Set<string>();
    for (const r of individualRows) {
      charRefIds.add(r.buyerCharacterId.toString());
      if (r.sellerCharacterId) charRefIds.add(r.sellerCharacterId.toString());
    }
    const charNames =
      charRefIds.size > 0
        ? await db
            .collection("characters")
            .find({ _id: { $in: [...charRefIds].map((s) => new ObjectId(s)) } })
            .project<{ _id: ObjectId; name: string; sequentialId?: number }>({
              _id: 1,
              name: 1,
              sequentialId: 1,
            })
            .toArray()
        : [];
    const charById = new Map(charNames.map((c) => [c._id.toString(), c]));

    // Build per-turn buckets
    type Row = {
      kind: "row";
      _id: string;
      turn: number;
      createdAt: Date;
      fromCurrency: string;
      toCurrency: string;
      amount: number;
      rate: number;
      spread: number;
      source: TradeSource;
      sourceRef: string | null;
      isBuyer: boolean;
      traderName: string | null;
      traderSequentialId: number | null;
    };
    type Summary = {
      kind: "summary";
      turn: number;
      source: "auto_dividend" | "auto_coupon";
      fromCurrency: string;
      toCurrency: string;
      totalAmount: number;
      totalSpread: number;
      avgRate: number;
      participantCount: number;
    };

    const byTurn = new Map<number, (Row | Summary)[]>();
    for (const t of windowTurns) byTurn.set(t, []);

    for (const r of individualRows) {
      const trader = charById.get(r.buyerCharacterId.toString());
      byTurn.get(r.turn)?.push({
        kind: "row",
        _id: r._id.toString(),
        turn: r.turn,
        createdAt: r.createdAt,
        fromCurrency: r.fromCurrency,
        toCurrency: r.toCurrency,
        amount: r.amount,
        rate: r.rate,
        spread: r.spread,
        source: r.source ?? "manual",
        sourceRef: r.sourceRef ?? null,
        isBuyer: r.buyerCharacterId.toString() === characterId.toString(),
        traderName: trader?.name ?? null,
        traderSequentialId: trader?.sequentialId ?? null,
      });
    }

    for (const row of autoSummaryRows) {
      const key = row._id as {
        turn: number;
        source: "auto_dividend" | "auto_coupon";
        fromCurrency: string;
        toCurrency: string;
      };
      byTurn.get(key.turn)?.push({
        kind: "summary",
        turn: key.turn,
        source: key.source,
        fromCurrency: key.fromCurrency,
        toCurrency: key.toCurrency,
        totalAmount: row.totalAmount as number,
        totalSpread: row.totalSpread as number,
        avgRate: row.avgRate as number,
        participantCount: row.participantCount as number,
      });
    }

    // Order inside each turn: summaries first (the "big ticket" turn-fire
    // aggregates), then individual rows by createdAt desc.
    const turns = windowTurns.map((t) => {
      const items = byTurn.get(t) ?? [];
      items.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "summary" ? -1 : 1;
        if (a.kind === "summary" && b.kind === "summary") {
          return a.source < b.source ? -1 : 1;
        }
        if (a.kind === "row" && b.kind === "row") {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        return 0;
      });
      return { turn: t, items };
    });

    return NextResponse.json({
      turns,
      offset,
      turnsRequested,
      hasMore: recentTurns.length > offset + turnsRequested,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
