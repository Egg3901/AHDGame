import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import { computeRealizedPnl, computeRealizedPnlByCorporation } from "./tradeLedger";

/**
 * Suggestion #38: a player's own trade history with real P&L. The FIFO walk is
 * the part that can silently invent or destroy money, so it is pinned against
 * hand-computed numbers.
 */

const ME = new ObjectId();
const THEM = new ObjectId();
const CORP = new ObjectId();
const CORP_B = new ObjectId();

let seq = 0;
function trade(
  over: Partial<ShareTradeHistory> & Pick<ShareTradeHistory, "kind" | "shares">
): ShareTradeHistory {
  seq += 1;
  const pricePerShareAnchor = over.pricePerShareAnchor ?? 0;
  return {
    _id: new ObjectId(),
    corporationId: over.corporationId ?? CORP,
    kind: over.kind,
    turn: over.turn ?? seq,
    createdAt: over.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, seq)),
    shares: over.shares,
    pricePerShareAnchor,
    totalAnchor: Math.round(over.shares * pricePerShareAnchor * 100) / 100,
    from: over.from ?? null,
    to: over.to ?? null,
    ...(over.structureChange ? { structureChange: over.structureChange } : {}),
  } as ShareTradeHistory;
}

const meParty = { characterId: ME, name: "Me" };
const themParty = { characterId: THEM, name: "Them" };

const buy = (shares: number, price: number) =>
  trade({ kind: "market_buy", shares, pricePerShareAnchor: price, to: meParty });
const sell = (shares: number, price: number) =>
  trade({ kind: "market_sell", shares, pricePerShareAnchor: price, from: meParty });

describe("computeRealizedPnl", () => {
  it("matches sales against the oldest lot first", () => {
    // Buy 100 @ 10, buy 100 @ 20, sell 150 @ 30.
    // FIFO basis = 100×10 + 50×20 = 2000. Proceeds = 150×30 = 4500. P&L = 2500.
    const res = computeRealizedPnl([buy(100, 10), buy(100, 20), sell(150, 30)], {
      characterId: ME,
    });
    const sale = res.entries.find((e) => e.side === "sell")!;
    expect(sale.costBasisAnchor).toBe(2000);
    expect(sale.realizedPnlAnchor).toBe(2500);
    expect(res.totalRealizedPnlAnchor).toBe(2500);
    // 50 shares left, all from the second lot at 20.
    expect(res.openShares).toBe(50);
    expect(res.openCostPerShareAnchor).toBe(20);
  });

  it("books a loss as a negative number", () => {
    const res = computeRealizedPnl([buy(10, 100), sell(10, 60)], { characterId: ME });
    expect(res.totalRealizedPnlAnchor).toBe(-400);
  });

  it("leaves buys with no P&L", () => {
    const res = computeRealizedPnl([buy(10, 5)], { characterId: ME });
    expect(res.entries[0].realizedPnlAnchor).toBeNull();
    expect(res.entries[0].costBasisAnchor).toBeNull();
  });

  it("rescales open lots across a forward split", () => {
    // Buy 100 @ 10 (basis 1000), 2:1 split → 200 @ 5, sell 200 @ 8 → 1600 − 1000 = 600.
    const split = trade({
      kind: "stock_split",
      shares: 0,
      structureChange: {
        oldTotalShares: 1_000,
        newTotalShares: 2_000,
        oldSharePriceLocal: 10,
        newSharePriceLocal: 5,
        oldPublicFloat: 0,
        newPublicFloat: 0,
        before: [],
        after: [],
      },
    });
    const res = computeRealizedPnl([buy(100, 10), split, sell(200, 8)], { characterId: ME });
    expect(res.totalRealizedPnlAnchor).toBe(600);
    expect(res.openShares).toBe(0);
  });

  it("rescales open lots across a reverse split", () => {
    // Buy 200 @ 5 (basis 1000), 1:2 reverse → 100 @ 10, sell 100 @ 12 → 1200 − 1000 = 200.
    const rsplit = trade({
      kind: "reverse_split",
      shares: 0,
      structureChange: {
        oldTotalShares: 2_000,
        newTotalShares: 1_000,
        oldSharePriceLocal: 5,
        newSharePriceLocal: 10,
        oldPublicFloat: 0,
        newPublicFloat: 0,
        before: [],
        after: [],
      },
    });
    const res = computeRealizedPnl([buy(200, 5), rsplit, sell(100, 12)], { characterId: ME });
    expect(res.totalRealizedPnlAnchor).toBe(200);
  });

  it("reports a sale with no open lot as unknown rather than pure profit", () => {
    // A position that predates the audit trail. Booking 500 of profit here
    // would invent money that was never made in-window.
    const res = computeRealizedPnl([sell(50, 10)], { characterId: ME });
    expect(res.entries[0].realizedPnlAnchor).toBeNull();
    expect(res.totalRealizedPnlAnchor).toBe(0);
    expect(res.hasUnmatchedSales).toBe(true);
  });

  it("flags a partially-matched sale instead of under-reporting silently", () => {
    const res = computeRealizedPnl([buy(10, 1), sell(50, 10)], { characterId: ME });
    expect(res.hasUnmatchedSales).toBe(true);
    expect(res.entries.find((e) => e.side === "sell")!.realizedPnlAnchor).toBeNull();
  });

  it("ignores rows the viewer is not party to", () => {
    const other = trade({
      kind: "peer_fill",
      shares: 999,
      pricePerShareAnchor: 50,
      from: themParty,
      to: { characterId: new ObjectId(), name: "Someone else" },
    });
    const res = computeRealizedPnl([buy(10, 1), other, sell(10, 2)], { characterId: ME });
    expect(res.entries).toHaveLength(2);
    expect(res.totalRealizedPnlAnchor).toBe(10);
  });

  it("realizes nothing when the viewer is both sides", () => {
    const selfMove = trade({
      kind: "correction",
      shares: 10,
      pricePerShareAnchor: 5,
      from: meParty,
      to: meParty,
    });
    const res = computeRealizedPnl([selfMove], { characterId: ME });
    expect(res.entries).toHaveLength(0);
    expect(res.totalRealizedPnlAnchor).toBe(0);
  });

  it("tracks a corporation viewer through corporationId", () => {
    const corpBuy = trade({
      kind: "market_buy",
      shares: 10,
      pricePerShareAnchor: 3,
      to: { corporationId: THEM, name: "Holding Co" },
    });
    const corpSell = trade({
      kind: "market_sell",
      shares: 10,
      pricePerShareAnchor: 8,
      from: { corporationId: THEM, name: "Holding Co" },
    });
    const res = computeRealizedPnl([corpBuy, corpSell], { corporationId: THEM });
    expect(res.totalRealizedPnlAnchor).toBe(50);
  });

  it("names the public float as the counterparty when it is the other side", () => {
    const res = computeRealizedPnl([buy(1, 1)], { characterId: ME });
    expect(res.entries[0].counterparty).toBe("Public float");
  });
});

describe("computeRealizedPnlByCorporation", () => {
  it("keeps FIFO lots separate per security", () => {
    // Without grouping, corp B's cheap lot would wrongly cover corp A's sale.
    const rows = [
      trade({ kind: "market_buy", shares: 10, pricePerShareAnchor: 100, to: meParty }),
      trade({
        kind: "market_buy",
        shares: 10,
        pricePerShareAnchor: 1,
        to: meParty,
        corporationId: CORP_B,
      }),
      trade({ kind: "market_sell", shares: 10, pricePerShareAnchor: 150, from: meParty }),
    ];
    const res = computeRealizedPnlByCorporation(rows, { characterId: ME });
    expect(res.byCorporation.get(CORP.toString())!.totalRealizedPnlAnchor).toBe(500);
    expect(res.byCorporation.get(CORP_B.toString())!.openShares).toBe(10);
    expect(res.totalRealizedPnlAnchor).toBe(500);
  });

  it("returns merged entries newest first", () => {
    const rows = [
      trade({ kind: "market_buy", shares: 1, pricePerShareAnchor: 1, to: meParty, turn: 5 }),
      trade({
        kind: "market_buy",
        shares: 1,
        pricePerShareAnchor: 1,
        to: meParty,
        turn: 9,
        corporationId: CORP_B,
      }),
    ];
    const res = computeRealizedPnlByCorporation(rows, { characterId: ME });
    expect(res.entries.map((e) => e.turn)).toEqual([9, 5]);
  });
});
