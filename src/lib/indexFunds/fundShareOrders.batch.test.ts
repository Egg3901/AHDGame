import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { TxInput } from "@/lib/financialTxLog/emit";
import {
  cancelFundShareOrder,
  cancelFundShareOrdersBatch,
  placeFundQuotesBatch,
  placeFundShareBuyOrder,
  placeFundShareSellOrder,
  type FundQuotePlacement,
} from "./fundShareOrders";

const FUND_ID = new ObjectId("650000000000000000000101");
const CORPS = [1, 2, 3].map((n) => new ObjectId(`65000000000000000000020${n}`));

function world() {
  const memory = createInMemoryDb();
  memory.seed("indexFunds", [
    {
      _id: FUND_ID,
      name: "Top 50",
      anchorCurrencyCode: "USD",
      cashAnchor: 100,
      holdings: CORPS.map((corporationId) => ({ corporationId, shares: 10 })),
    },
  ]);
  return { memory, db: memory as unknown as Db };
}

const fund = {
  _id: FUND_ID,
  name: "Top 50",
  anchorCurrencyCode: "USD" as const,
  holdings: CORPS.map((corporationId) => ({ corporationId, shares: 10 })),
};
const corp = (i: number) => ({
  _id: CORPS[i],
  liquidCurrencyCode: "USD" as const,
  countryId: "US" as const,
});

/** Comparable state: fund cash, and each order's business fields in placement order. */
function state(memory: ReturnType<typeof createInMemoryDb>) {
  return {
    cash: memory.collection("indexFunds").docs[0]?.cashAnchor,
    orders: memory
      .collection("shareOrders")
      .docs.map((order) => [
        String(order.corporationId),
        order.type,
        order.shares,
        order.pricePerShare,
        order.escrowAnchor ?? 0,
        order.status,
      ]),
  };
}

describe("batched fund quote placement", () => {
  // Bid escrow 40, then 70 (cannot be funded from the 60 left: its ask is
  // skipped too), then 50. The second corporation's ask exceeds holdings.
  const placements: FundQuotePlacement[] = [
    { bid: bid(0, 4, 10), ask: ask(0, 5, 12) },
    { bid: bid(1, 7, 10), ask: ask(1, 5, 12) },
    { bid: bid(2, 5, 10), ask: ask(2, 50, 12) },
  ];
  function bid(i: number, shares: number, price: number) {
    return { fund, corp: corp(i), shares, limitPriceLocal: price, fxRate: 1, turn: 9 };
  }
  function ask(i: number, shares: number, price: number) {
    return { corp: corp(i), shares, limitPriceLocal: price };
  }

  it("makes the same decisions, debits and orders as placing quotes one at a time", async () => {
    const one = world();
    const ledger: TxInput[] = [];
    for (const placement of placements) {
      const placedBid = await placeFundShareBuyOrder(one.db, {
        ...placement.bid,
        ledgerSink: ledger,
        txSink: [],
      });
      if (!placedBid.ok || !placement.ask) continue;
      await placeFundShareSellOrder(one.db, { ...placement.ask, fund, reservedOpenShares: 0 });
    }

    const batch = world();
    const placed = await placeFundQuotesBatch(batch.db, fund, placements, new Map());
    expect(placed).not.toBeNull();
    expect(placed!.results.map((r) => [r.bid.ok, r.ask?.ok])).toEqual([
      [true, true],
      [false, undefined],
      [true, false],
    ]);
    expect(state(batch.memory)).toEqual(state(one.memory));
    expect(state(batch.memory).cash).toBe(10);
    expect(placed!.ledgerEntries.map((row) => row.amount)).toEqual(ledger.map((row) => row.amount));
    expect(placed!.escrowTxs).toHaveLength(2);
  });

  it("writes nothing and declines when the fund's cash moved underneath", async () => {
    const batch = world();
    await batch.memory
      .collection("indexFunds")
      .updateOne({ _id: FUND_ID }, { $set: { cashAnchor: 100 } });
    const original = batch.memory
      .collection("indexFunds")
      .findOne.bind(batch.memory.collection("indexFunds"));
    // A concurrent debit lands between the batch's cash read and its debit.
    batch.memory.collection("indexFunds").findOne = (async (...args: unknown[]) => {
      const row = await (original as (...a: unknown[]) => Promise<unknown>)(...args);
      await batch.memory
        .collection("indexFunds")
        .updateOne({ _id: FUND_ID }, { $inc: { cashAnchor: -1 } });
      return row;
    }) as typeof original;
    const placed = await placeFundQuotesBatch(batch.db, fund, placements, new Map());
    expect(placed).toBeNull();
    expect(batch.memory.collection("shareOrders").docs).toHaveLength(0);
    expect(batch.memory.collection("indexFunds").docs[0]?.cashAnchor).toBe(99);
  });
});

describe("batched fund order cancellation", () => {
  it("claims, refunds and records exactly what one-at-a-time cancels would", async () => {
    const seed = (memory: ReturnType<typeof createInMemoryDb>) =>
      memory.seed("shareOrders", [
        order(1, "buy", 25, "open"),
        order(2, "sell", 0, "open"),
        order(3, "buy", 15, "filled"),
        order(4, "buy", 30, "open"),
      ]);
    function order(n: number, type: string, escrowAnchor: number, status: string) {
      return {
        _id: new ObjectId(`65000000000000000000030${n}`),
        placerFundId: FUND_ID,
        corporationId: CORPS[0],
        type,
        shares: 1,
        sharesRemaining: 1,
        pricePerShare: 1,
        escrowAnchor,
        status,
      };
    }
    const ids = [1, 2, 3, 4].map((n) => new ObjectId(`65000000000000000000030${n}`));

    const one = world();
    seed(one.memory);
    const oneLedger: TxInput[] = [];
    for (const id of ids)
      await cancelFundShareOrder(one.db, id, 9, { fund, ledgerSink: oneLedger });

    const batch = world();
    seed(batch.memory);
    const batchLedger: TxInput[] = [];
    expect(
      await cancelFundShareOrdersBatch(batch.db, fund, ids, 9, { ledgerSink: batchLedger })
    ).toBe(true);

    expect(state(batch.memory)).toEqual(state(one.memory));
    expect(state(batch.memory).cash).toBe(155);
    const rows = (ledger: TxInput[]) =>
      ledger.map((row) => [row.type, row.amount, (row.meta as { orderId: string }).orderId]);
    expect(rows(batchLedger)).toEqual(rows(oneLedger));

    // A repeat cancels nothing more and refunds nothing more.
    await cancelFundShareOrdersBatch(batch.db, fund, ids, 9, { ledgerSink: [] });
    expect(state(batch.memory).cash).toBe(155);
  });
});
