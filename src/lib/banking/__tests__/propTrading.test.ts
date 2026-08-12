import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter, PropPosition } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { CONFIDENCE_FORCED_LIQUIDATION_PENALTY, computeConfidence } from "../confidence";
import {
  PER_CURRENCY_FOREX_CAP_FRACTION,
  PROP_LEVERAGE_MULTIPLE,
  closePosition,
  computePropEquityBase,
  forceLiquidateToLeverageCap,
  markBook,
  openPosition,
  sumPositionMarks,
} from "../propTrading";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "investment",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 100_000,
    depositOffset: 0,
    lendingOffset: 0,
    propBook: [],
    propBookMarkValue: 0,
    interbankDebt: 0,
    cbMarginDebt: 0,
    ...overrides,
  };
}

describe("computePropEquityBase", () => {
  it("sums liquid + posted + mark and nets interbank + CB margin debt", () => {
    expect(
      computePropEquityBase(50_000, {
        postedCapital: 100_000,
        propBookMarkValue: 80_000,
        interbankDebt: 20_000,
        cbMarginDebt: 10_000,
      })
    ).toBe(200_000);
  });

  it("falls back to summing position marks when cache absent", () => {
    const book: PropPosition[] = [
      { asset: "equity", ref: "a", units: 1, costBasis: 10, markValue: 12 },
      { asset: "forex", ref: "EUR", units: 5, costBasis: 5, markValue: 6 },
    ];
    expect(
      computePropEquityBase(0, {
        postedCapital: 0,
        propBook: book,
      })
    ).toBe(18);
  });
});

describe("propTrading open/close/mark", () => {
  let db: MockDb;
  let corpId: ObjectId;
  let liveCorp: Corporation;
  let fxDocs: { currencyCode: string; rate: number }[];
  let equityCorp: Corporation;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetCorpFxRateCacheForTests } = await import("@/lib/currency/corporationCapital");
    resetCorpFxRateCacheForTests();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("corporations");
    db.collection("exchangeRates");
    db.collection("indexFunds");
    db.collection("bonds");

    corpId = new ObjectId();
    const targetId = new ObjectId();
    liveCorp = {
      _id: corpId,
      name: "IB",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
      countryId: "US",
      bankCharter: makeCharter(),
    } as unknown as Corporation;

    equityCorp = {
      _id: targetId,
      name: "Target",
      sharePrice: 10,
      liquidCurrencyCode: "USD",
      countryId: "US",
    } as unknown as Corporation;

    fxDocs = [
      { currencyCode: "USD", rate: 1 },
      { currencyCode: "EUR", rate: 1 },
    ];

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
    });

    db.collectionMocks.corporations!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId; name?: unknown }) => {
        if (filter?.name && typeof filter.name === "object" && "$regex" in filter.name) {
          const query = filter.name as { $regex?: string; $options?: string };
          const matches = query.$regex
            ? new RegExp(query.$regex, query.$options).test(equityCorp.name)
            : false;
          return matches ? { ...equityCorp } : null;
        }
        if (!filter?._id) return null;
        if (filter._id.equals(corpId)) {
          return {
            ...liveCorp,
            bankCharter: liveCorp.bankCharter
              ? { ...liveCorp.bankCharter, propBook: [...(liveCorp.bankCharter.propBook ?? [])] }
              : undefined,
          };
        }
        if (filter._id.equals(targetId)) return { ...equityCorp };
        return null;
      }
    );

    db.collectionMocks.corporations!.updateOne.mockImplementation(
      async (
        filter: { _id?: ObjectId; liquidCapital?: unknown },
        update: { $inc?: Record<string, number>; $set?: Record<string, unknown> }
      ) => {
        if (!filter?._id?.equals(corpId)) return { matchedCount: 0, modifiedCount: 0 };
        if (filter.liquidCapital && typeof filter.liquidCapital === "object") {
          const gte = (filter.liquidCapital as { $gte?: number }).$gte ?? 0;
          if ((liveCorp.liquidCapital ?? 0) < gte) return { matchedCount: 0, modifiedCount: 0 };
        }
        if (update.$inc?.liquidCapital) {
          liveCorp.liquidCapital = (liveCorp.liquidCapital ?? 0) + update.$inc.liquidCapital;
        }
        if (update.$set?.liquidCapital !== undefined) {
          liveCorp.liquidCapital = update.$set.liquidCapital as number;
        }
        if (liveCorp.bankCharter && update.$set) {
          if (update.$set["bankCharter.propBook"] !== undefined) {
            liveCorp.bankCharter.propBook = update.$set["bankCharter.propBook"] as PropPosition[];
          }
          if (update.$set["bankCharter.propBookMarkValue"] !== undefined) {
            liveCorp.bankCharter.propBookMarkValue = update.$set[
              "bankCharter.propBookMarkValue"
            ] as number;
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    db.collectionMocks.exchangeRates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(fxDocs),
      project: vi.fn().mockReturnThis(),
    });
  });

  it("enforces leverage cap on open", async () => {
    // True equity stays ~300k once debt is netted; max mark = 900k.
    // Buy 901k of equity while holding enough cash → leverage breach.
    liveCorp.liquidCapital = 950_000;
    liveCorp.bankCharter = makeCharter({
      postedCapital: 100_000,
      interbankDebt: 750_000,
      propBook: [],
      propBookMarkValue: 0,
    });
    const targetId = equityCorp._id.toString();
    const result = await openPosition(db as unknown as Db, corpId, {
      asset: "equity",
      ref: targetId,
      units: 90_100, // 901_000 at $10
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/leverage/i);
  });

  it("enforces per-currency forex cap", async () => {
    // equity ≈ 1.1M; forex cap 0.5 * equity = 550k. Buy 600k EUR at 1:1.
    const result = await openPosition(db as unknown as Db, corpId, {
      asset: "forex",
      ref: "EUR",
      units: 600_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/forex/i);
  });

  it("conserves cash on open and close (market counterparty)", async () => {
    const targetId = equityCorp._id.toString();
    const before = liveCorp.liquidCapital ?? 0;
    const opened = await openPosition(db as unknown as Db, corpId, {
      asset: "equity",
      ref: targetId,
      units: 1_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.cost).toBe(10_000);
    expect(liveCorp.liquidCapital).toBe(before - 10_000);
    expect(sumPositionMarks(liveCorp.bankCharter?.propBook)).toBe(10_000);

    // Mark price up: sharePrice 12 → close realizes gain from market.
    equityCorp.sharePrice = 12;
    const closed = await closePosition(db as unknown as Db, corpId, {
      asset: "equity",
      ref: targetId,
      units: 1_000,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.proceeds).toBe(12_000);
    expect(closed.realizedPnl).toBe(2_000);
    expect(liveCorp.liquidCapital).toBe(before + 2_000);
    expect(liveCorp.bankCharter?.propBook ?? []).toHaveLength(0);
  });

  it("opens an equity position by the corporation's displayed name", async () => {
    const opened = await openPosition(db as unknown as Db, corpId, {
      asset: "equity",
      ref: "Target",
      units: 100,
    });

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.position.ref).toBe(equityCorp._id.toString());
  });

  it("markBook updates mark values without moving cash", async () => {
    liveCorp.bankCharter = makeCharter({
      propBook: [
        {
          asset: "equity",
          ref: equityCorp._id.toString(),
          units: 100,
          costBasis: 1_000,
          markValue: 1_000,
        },
      ],
      propBookMarkValue: 1_000,
    });
    const cashBefore = liveCorp.liquidCapital;
    equityCorp.sharePrice = 15;
    const marked = await markBook(db as unknown as Db, liveCorp.bankCharter);
    expect(marked.propBookMarkValue).toBe(1_500);
    expect(liveCorp.liquidCapital).toBe(cashBefore);
  });

  it("force liquidation shrinks mark to leverage cap and returns cash", async () => {
    // L=50k + P=50k + M=1M - D=850k → equity=250k; ratio=4 > 3 → force
    liveCorp.liquidCapital = 50_000;
    liveCorp.bankCharter = makeCharter({
      postedCapital: 50_000,
      interbankDebt: 850_000,
      propBook: [
        {
          asset: "equity",
          ref: equityCorp._id.toString(),
          units: 100_000,
          costBasis: 1_000_000,
          markValue: 1_000_000,
        },
      ],
      propBookMarkValue: 1_000_000,
    });
    equityCorp.sharePrice = 10;
    const marked = await markBook(db as unknown as Db, liveCorp.bankCharter!);
    expect(marked.propBookMarkValue).toBe(1_000_000);
    const result = await forceLiquidateToLeverageCap(
      db as unknown as Db,
      corpId,
      liveCorp.liquidCapital!,
      liveCorp.bankCharter!,
      marked
    );
    expect(result.forced).toBe(true);
    const equity = computePropEquityBase(result.liquidCapital, result.charter);
    expect(result.charter.propBookMarkValue ?? 0).toBeLessThanOrEqual(
      PROP_LEVERAGE_MULTIPLE * equity + 1e-6
    );
    expect(result.liquidCapital + (result.charter.propBookMarkValue ?? 0)).toBeCloseTo(
      50_000 + 1_000_000,
      5
    );
  });
});

describe("forced liquidation confidence penalty", () => {
  it("subtracts the provisional flat penalty", () => {
    const base = computeConfidence({
      liquidCapital: 200_000,
      postedCapital: 200_000,
      totalDeposits: 0,
      totalLoans: 0,
      reserveRatioRequired: 0.1,
      arrearsOutstanding: 0,
      defaultsLastTurn: 0,
      panicTurns: 0,
    });
    const penalized = computeConfidence({
      liquidCapital: 200_000,
      postedCapital: 200_000,
      totalDeposits: 0,
      totalLoans: 0,
      reserveRatioRequired: 0.1,
      arrearsOutstanding: 0,
      defaultsLastTurn: 0,
      panicTurns: 0,
      forcedLiquidation: true,
    });
    expect(base.confidence - penalized.confidence).toBeCloseTo(
      CONFIDENCE_FORCED_LIQUIDATION_PENALTY,
      5
    );
  });
});

describe("forex cap constant", () => {
  it("exports the locked provisional fractions", () => {
    expect(PROP_LEVERAGE_MULTIPLE).toBe(3);
    expect(PER_CURRENCY_FOREX_CAP_FRACTION).toBe(0.5);
  });
});
