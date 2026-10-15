import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types/indexFund";

vi.mock("@/lib/db/sessionDb", () => ({
  withSessionDb: async (db: Db, work: (tx: Db) => Promise<unknown>) => work(db),
  afterCommit: async (_db: Db, effect: () => Promise<unknown>) => effect(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  creditCorpLiquidCapital: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: (a: number) => a,
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: () => "USD",
}));
vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingsForRedemptionCash: vi.fn().mockResolvedValue({
    cashRaisedAnchor: 0,
    sharesSold: 0,
    salesExecuted: 0,
  }),
}));
vi.mock("@/lib/bonds/sellFundBondUnits", () => ({
  sellFundBondHoldingsForCash: vi
    .fn()
    .mockResolvedValue({ proceedsAnchor: 0, unitsSold: 0, bondsTouched: 0 }),
}));
// Mirrors the real contract: a fund_reserve position is the fund's own units
// and is never paid out.
vi.mock("./holderPayout", () => ({
  payFundHolderCash: vi.fn(
    async (_db: unknown, _fund: unknown, position: { holderKind: string }) =>
      position.holderKind !== "fund_reserve"
  ),
}));

import { creditCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { sellFundHoldingsForRedemptionCash } from "@/lib/indexFunds/fundRedemptionLiquidity";
import { sellFundBondHoldingsForCash } from "@/lib/bonds/sellFundBondUnits";
import { payFundHolderCash } from "./holderPayout";
import { advanceWindDowns, beginWindUp, completeWindUp } from "./windUp";

const SPONSOR = new ObjectId();

function makeFund(over: Partial<IndexFund> = {}): IndexFund {
  return {
    _id: new ObjectId(),
    slug: "sponsored-nit",
    name: "Northern Industrial Trust",
    tickerSymbol: "NIT",
    scope: "country",
    kind: "broad",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1_000,
    reserveUnits: 0,
    cashAnchor: 100_000,
    targetConstituents: [],
    holdings: [],
    sponsorCorporationId: SPONSOR,
    sponsorName: "Sponsor Co",
    expenseRatioAnnual: 0.01,
    seedCapitalAnchor: 10_000_000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as IndexFund;
}

function makeDb(opts: {
  positions?: Partial<IndexFundPosition>[];
  windingDown?: IndexFund[];
  sponsorExists?: boolean;
  claimed?: boolean;
  fund?: IndexFund;
  bondsRemaining?: () => number;
}) {
  const fundUpdate = vi.fn().mockResolvedValue({ modifiedCount: opts.claimed === false ? 0 : 1 });
  const positionsUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const txInsert = vi.fn().mockResolvedValue({ acknowledged: true });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "indexFunds")
        return {
          updateOne: fundUpdate,
          findOne: async () =>
            opts.fund ?? opts.windingDown?.[0] ?? makeFund({ status: "winding_down" }),
          find: () => ({ toArray: () => Promise.resolve(opts.windingDown ?? []) }),
        };
      if (name === "indexFundPositions")
        return {
          find: () => ({ toArray: () => Promise.resolve(opts.positions ?? []) }),
          updateMany: positionsUpdateMany,
        };
      if (name === "bonds")
        return {
          countDocuments: vi.fn(async () => opts.bondsRemaining?.() ?? 0),
          aggregate: vi.fn(() => ({
            toArray: async () =>
              (opts.bondsRemaining?.() ?? 0) > 0
                ? (opts.windingDown ?? []).map((f) => ({ _id: f._id }))
                : [],
          })),
        };
      if (name === "indexFundTransactions") return { insertOne: txInsert };
      if (name === "corporations")
        return {
          findOne: vi
            .fn()
            .mockResolvedValue(
              opts.sponsorExists === false ? null : { _id: SPONSOR, name: "Sponsor Co" }
            ),
        };
      return { countDocuments: vi.fn().mockResolvedValue(0) };
    }),
  } as unknown as Db;
  return { db, fundUpdate, positionsUpdateMany, txInsert };
}

describe("beginWindUp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to wind up a system fund, which has no sponsor", async () => {
    const { db } = makeDb({});
    const r = await beginWindUp(db, makeFund({ sponsorCorporationId: undefined }), 100);
    expect(r.ok).toBe(false);
  });

  it("is idempotent once a wind-up is already running", async () => {
    const { db, fundUpdate } = makeDb({});
    const r = await beginWindUp(db, makeFund({ status: "winding_down" }), 100);
    expect(r.ok).toBe(true);
    expect(fundUpdate).not.toHaveBeenCalled();
  });

  it("loses the race rather than restarting a fund someone else closed", async () => {
    const { db } = makeDb({ claimed: false });
    const r = await beginWindUp(db, makeFund(), 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe("completeWindUp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pays holders at what the cash actually supports, not the last quote", async () => {
    // Marked at NAV 100 × 1,000 units = 100,000, but the portfolio only sold
    // for 80,000. Holders take that loss here; nobody covers an unfundable
    // quote.
    const positions = [{ _id: new ObjectId(), units: 1_000, holderKind: "character" as const }];
    const fund = makeFund({ status: "winding_down", cashAnchor: 80_000, quotedNav: 100 });
    const { db } = makeDb({ positions, fund });
    await completeWindUp(db, fund, 200);

    const payout = vi.mocked(payFundHolderCash).mock.calls[0][3];
    expect(payout).toBe(80_000);
  });

  it("returns the sponsor only what is left after holders are paid", async () => {
    const positions = [{ _id: new ObjectId(), units: 500, holderKind: "character" as const }];
    // 500 units against 100,000 cash → NAV 200, holders take 100,000, nothing
    // remains for the sponsor even though they seeded ₳10m.
    const fund = makeFund({ status: "winding_down", cashAnchor: 100_000, unitSupply: 500 });
    const { db } = makeDb({ positions, fund });
    await completeWindUp(db, fund, 200);
    expect(vi.mocked(creditCorpLiquidCapital)).not.toHaveBeenCalled();
  });

  it("does not pay the fund's own reserve units, and returns their share to the sponsor", async () => {
    // Half the units are the fund's own reserve. Those are not a liability to
    // anyone, so the cash behind them is what the sponsor gets back.
    const positions = [
      { _id: new ObjectId(), units: 500, holderKind: "character" as const },
      { _id: new ObjectId(), units: 500, holderKind: "fund_reserve" as const },
    ];
    const fund = makeFund({ status: "winding_down", cashAnchor: 100_000, unitSupply: 1_000 });
    const { db } = makeDb({ positions, fund });
    await completeWindUp(db, fund, 200);
    // NAV = 100,000 / 1,000 = 100. The character takes 50,000; the reserve's
    // 50,000 falls through to the sponsor.
    expect(vi.mocked(creditCorpLiquidCapital)).toHaveBeenCalledWith(db, SPONSOR, 50_000);
  });

  it("returns the whole balance to the sponsor when no units are held", async () => {
    const fund = makeFund({ status: "winding_down", cashAnchor: 250_000, unitSupply: 0 });
    const { db } = makeDb({ positions: [], fund });
    await completeWindUp(db, fund, 200);
    expect(vi.mocked(creditCorpLiquidCapital)).toHaveBeenCalledWith(db, SPONSOR, 250_000);
  });

  it("delists the fund and zeroes its units", async () => {
    const fund = makeFund({ status: "winding_down", cashAnchor: 0, unitSupply: 0 });
    const { db, fundUpdate, positionsUpdateMany } = makeDb({ positions: [], fund });
    await completeWindUp(db, fund, 200);
    const set = fundUpdate.mock.calls[0][1].$set;
    expect(set.status).toBe("delisted");
    expect(set.unitSupply).toBe(0);
    expect(set.cashAnchor).toBe(0);
    expect(positionsUpdateMany).toHaveBeenCalled();
  });
});

describe("advanceWindDowns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sells the portfolio first and does not pay anyone while holdings remain", async () => {
    const fund = makeFund({
      status: "winding_down",
      holdings: [{ corporationId: new ObjectId(), shares: 10, lastValueAnchor: 50_000 }],
    });
    const { db } = makeDb({ windingDown: [fund], positions: [] });
    const r = await advanceWindDowns(db, 200);
    expect(r.fundsProcessed).toBe(1);
    expect(r.fundsCompleted).toBe(0);
    expect(vi.mocked(sellFundHoldingsForRedemptionCash)).toHaveBeenCalled();
    expect(vi.mocked(payFundHolderCash)).not.toHaveBeenCalled();
  });

  it("sells bonds before completing and pays out the fresh cash balance", async () => {
    const fund = makeFund({ status: "winding_down", cashAnchor: 10_000 });
    const current = { ...fund };
    let bondsRemaining = 1;
    const { db, fundUpdate } = makeDb({
      windingDown: [fund],
      fund: current,
      bondsRemaining: () => bondsRemaining,
    });
    vi.mocked(sellFundBondHoldingsForCash).mockImplementationOnce(async () => {
      bondsRemaining = 0;
      current.cashAnchor += 5_000;
      return { proceedsAnchor: 5_000, unitsSold: 10, bondsTouched: 1 };
    });
    const r = await advanceWindDowns(db, 200);
    expect(sellFundBondHoldingsForCash).toHaveBeenCalledWith(
      db,
      fund,
      Number.POSITIVE_INFINITY,
      expect.any(Date),
      { turn: 200 }
    );
    expect(r.fundsCompleted).toBe(1);
    expect(r.errors).toEqual([]);
    expect(fundUpdate.mock.calls[0][1].$set.status).toBe("delisted");
    expect(creditCorpLiquidCapital).toHaveBeenCalledWith(db, SPONSOR, 15_000);
  });

  it("waits without an error when bond units remain after a sale", async () => {
    const fund = makeFund({ status: "winding_down" });
    const { db, fundUpdate } = makeDb({ windingDown: [fund], bondsRemaining: () => 1 });
    const r = await advanceWindDowns(db, 200);
    expect(sellFundBondHoldingsForCash).toHaveBeenCalled();
    expect(r.fundsCompleted).toBe(0);
    expect(r.errors).toEqual([]);
    expect(fundUpdate).not.toHaveBeenCalled();
    expect(payFundHolderCash).not.toHaveBeenCalled();
  });

  it("finishes a fund whose portfolio has become cash", async () => {
    const fund = makeFund({ status: "winding_down", holdings: [], cashAnchor: 10_000 });
    const { db } = makeDb({ windingDown: [fund], positions: [] });
    const r = await advanceWindDowns(db, 200);
    expect(r.fundsCompleted).toBe(1);
  });
});
