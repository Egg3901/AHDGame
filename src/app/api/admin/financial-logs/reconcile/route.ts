// GET /api/admin/financial-logs/reconcile?subjectId=...&turns=24
//
// Compares the logged net of financialTxLog for a given subject over the last
// `turns` turns against the actual balance delta read from `portfolioHistory`
// snapshots. The result is the same "logged net vs actual" calculation we ran
// by hand to surface the bond-buy exploit:
//
//   - For each turn snapshot in [now - turns, now], read total/cash/stock/bond
//     value (denominated in anchor units).
//   - Sum every financialTxLog row's `amount` for the subject in the same
//     window, converted to anchor where currency rates allow.
//   - Discrepancy = (actualΔ) − (loggedΔ). Anything ≫ 0 means cash flowed
//     into the subject without a logged tx; ≪ 0 means logged tx outpaced
//     actual movement (refund / cancel / reversal not captured).
//
// Auth: requireAdmin. Errors: 400 (invalid params), 401, 403, 404 (no
// portfolioHistory rows for the subject), 500.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { FinancialTxLogEntry, FinancialSubjectType } from "@/lib/db/types/financialTxLog";
import type { PortfolioHistory, GameState, ExchangeRate } from "@/lib/db/types";

const DEFAULT_TURNS = 24;
const MAX_TURNS = 168; // matches retention window

interface PerTypeNet {
  type: string;
  count: number;
  netAnchor: number;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const subjectIdParam = searchParams.get("subjectId");
    const subjectTypeParam = searchParams.get("subjectType") ?? "character";
    const turnsParam = searchParams.get("turns");
    const turns = Math.min(
      MAX_TURNS,
      Math.max(1, parseInt(turnsParam ?? String(DEFAULT_TURNS), 10) || DEFAULT_TURNS)
    );

    if (!subjectIdParam || !/^[0-9a-f]{24}$/i.test(subjectIdParam)) {
      return NextResponse.json({ error: "Invalid subjectId" }, { status: 400 });
    }
    if (!["character", "corporation"].includes(subjectTypeParam)) {
      return NextResponse.json(
        { error: "Reconcile only supports character / corporation subjects" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const subjectId = new ObjectId(subjectIdParam);

    const [gameState, exchangeRates] = await Promise.all([
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
      db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    ]);
    const currentTurn = gameState?.currentTurn ?? 0;
    const minTurn = Math.max(0, currentTurn - turns);

    // FX rates: anchor-per-local. Used only as a fallback for legacy rows that
    // predate `financialTxLog.anchorAmount`; modern rows carry their own
    // anchor-denominated snapshot captured at emit time.
    const ratesByCurrency = new Map<string, number>();
    for (const r of exchangeRates) {
      ratesByCurrency.set(r.currencyCode as string, r.rate);
    }
    const toAnchor = (amount: number, currency: string): number => {
      const rate = ratesByCurrency.get(currency);
      if (!rate || rate <= 0) return amount; // best-effort fallback
      // Application convention: exchangeRate.rate is "local per 1 anchor",
      // so anchor = local / rate. portfolioHistory totalValue / cashValue
      // are emitted in anchor units (see portfolioSnapshot.ts).
      return amount / rate;
    };

    // Pull tx rows for both subject + counterparty positions on this entity.
    // For the actual-net comparison only the SUBJECT side counts (counterparty
    // entries don't move this entity's wallet).
    const txRows = await db
      .collection<FinancialTxLogEntry>("financialTxLog")
      .find({
        subjectId,
        subjectType: subjectTypeParam as FinancialSubjectType,
        turn: { $gte: minTurn, $lte: currentTurn },
      })
      .sort({ turn: 1 })
      .toArray();

    const perType = new Map<string, PerTypeNet>();
    let loggedNetAnchor = 0;
    for (const t of txRows) {
      const anchorAmt = t.anchorAmount ?? toAnchor(t.amount, t.currencyCode);
      loggedNetAnchor += anchorAmt;
      const existing = perType.get(t.type) ?? { type: t.type, count: 0, netAnchor: 0 };
      existing.count++;
      existing.netAnchor += anchorAmt;
      perType.set(t.type, existing);
    }

    // Pull portfolioHistory snapshots in window. Use both endpoints to compute
    // the actual cash/total delta. Only character subjects have these — corp
    // subjects use corporationPortfolioHistory which has the same shape.
    const snapshotCollection =
      subjectTypeParam === "character" ? "portfolioHistory" : "corporationPortfolioHistory";
    const idField = subjectTypeParam === "character" ? "characterId" : "corporationId";

    const snapshots = await db
      .collection<PortfolioHistory>(snapshotCollection)
      .find({ [idField]: subjectId, turn: { $gte: minTurn, $lte: currentTurn } } as never)
      .sort({ turn: 1 })
      .toArray();

    if (snapshots.length < 2) {
      return NextResponse.json({
        subjectId: subjectIdParam,
        subjectType: subjectTypeParam,
        currentTurn,
        windowTurns: turns,
        turnsAvailable: snapshots.length,
        reconcilable: false,
        message: "Need ≥2 portfolioHistory snapshots in window to reconcile",
        loggedNetAnchor,
        perType: [...perType.values()],
      });
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];

    // We compare CASH delta to logged net, since logged tx primarily move cash
    // (stock value and bond value drift independently from price/coupon). For
    // a true "every dollar accounted for" check, restrict subjects to cash-only.
    const actualCashDeltaAnchor = (last.cashValue ?? 0) - (first.cashValue ?? 0);
    const actualTotalDeltaAnchor = (last.totalValue ?? 0) - (first.totalValue ?? 0);
    const unaccountedAnchor = actualCashDeltaAnchor - loggedNetAnchor;

    return NextResponse.json({
      subjectId: subjectIdParam,
      subjectType: subjectTypeParam,
      currentTurn,
      windowTurns: turns,
      windowTurnsActual: last.turn - first.turn,
      reconcilable: true,
      firstSnapshot: {
        turn: first.turn,
        createdAt: first.createdAt,
        cashAnchor: first.cashValue ?? 0,
        stockAnchor: first.stockValue ?? 0,
        bondAnchor: first.bondValue ?? 0,
        totalAnchor: first.totalValue ?? 0,
      },
      lastSnapshot: {
        turn: last.turn,
        createdAt: last.createdAt,
        cashAnchor: last.cashValue ?? 0,
        stockAnchor: last.stockValue ?? 0,
        bondAnchor: last.bondValue ?? 0,
        totalAnchor: last.totalValue ?? 0,
      },
      actualCashDeltaAnchor,
      actualTotalDeltaAnchor,
      loggedNetAnchor,
      // Headline metric: positive = phantom inflow (cash arrived without a
      // logged tx, the bond-buy bug pattern); negative = logged net exceeds
      // actual movement (refunds / cancels not captured).
      unaccountedAnchor,
      txCount: txRows.length,
      perType: [...perType.values()].sort((a, b) => Math.abs(b.netAnchor) - Math.abs(a.netAnchor)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export type ReconcileResult = {
  unaccountedAnchor: number;
  loggedNetAnchor: number;
  actualCashDeltaAnchor: number;
};
