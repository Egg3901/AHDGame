import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter, InterbankLoan } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { ARREARS_DEFAULT_TURNS, processBankingTurn } from "@/lib/turn/bankingTurn";
import {
  CB_MARGIN_COLLATERAL_FRACTION,
  CB_MARGIN_SPREAD_PP,
  INTERBANK_MAX_SHARE_OF_LENDABLE,
  drawCbMargin,
  lendInterbank,
  repayCbMargin,
  repayInterbank,
} from "../interbank";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(50) }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

function makeCharter(type: BankCharter["type"], overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type,
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 100_000,
    depositOffset: 0,
    lendingOffset: 0,
    totalDeposits: 1_000_000,
    totalLoans: 0,
    npcDeposits: 0,
    propBookMarkValue: 0,
    interbankDebt: 0,
    cbMarginDebt: 0,
    ...overrides,
  };
}

describe("interbank lend/repay", () => {
  let db: MockDb;
  let lenderId: ObjectId;
  let borrowerId: ObjectId;
  let live: Map<string, Corporation>;
  let loans: InterbankLoan[];

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("corporations");
    db.collection("centralBanks");
    db.collection("interbankLoans");
    db.collection("gameState");

    lenderId = new ObjectId();
    borrowerId = new ObjectId();
    loans = [];
    live = new Map([
      [
        lenderId.toString(),
        {
          _id: lenderId,
          name: "Retail",
          liquidCapital: 0,
          bankCharter: makeCharter("retail", {
            totalDeposits: 1_000_000,
            totalLoans: 0,
            cashReserves: 500_000,
          }),
        } as unknown as Corporation,
      ],
      [
        borrowerId.toString(),
        {
          _id: borrowerId,
          name: "IB",
          liquidCapital: 0,
          bankCharter: makeCharter("investment", {
            totalDeposits: 0,
            totalLoans: 0,
            propBookMarkValue: 200_000,
            cashReserves: 50_000,
          }),
        } as unknown as Corporation,
      ],
    ]);

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
    });
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US-FED",
      bankReserveRequirement: 0.1,
      primeRate: 4,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({ _id: "current", currentTurn: 50 });

    db.collectionMocks.corporations!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => {
        if (!filter?._id) return null;
        const c = live.get(filter._id.toString());
        return c ? { ...c, bankCharter: c.bankCharter ? { ...c.bankCharter } : undefined } : null;
      }
    );

    db.collectionMocks.corporations!.updateOne.mockImplementation(
      async (
        filter: { _id?: ObjectId; "bankCharter.cashReserves"?: { $gte?: number } },
        update: { $inc?: Record<string, number>; $set?: Record<string, unknown> }
      ) => {
        if (!filter?._id) return { matchedCount: 0, modifiedCount: 0 };
        const c = live.get(filter._id.toString());
        if (!c) return { matchedCount: 0, modifiedCount: 0 };
        if (
          filter["bankCharter.cashReserves"]?.$gte != null &&
          (c.bankCharter?.cashReserves ?? 0) < filter["bankCharter.cashReserves"]!.$gte!
        ) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        if (update.$inc) {
          for (const [k, v] of Object.entries(update.$inc)) {
            if (k === "liquidCapital") c.liquidCapital = (c.liquidCapital ?? 0) + v;
            if (k === "bankCharter.cashReserves" && c.bankCharter) {
              c.bankCharter.cashReserves = (c.bankCharter.cashReserves ?? 0) + v;
            } else if (k === "bankCharter.interbankDebt" && c.bankCharter) {
              c.bankCharter.interbankDebt = (c.bankCharter.interbankDebt ?? 0) + v;
            } else if (k === "bankCharter.cbMarginDebt" && c.bankCharter) {
              c.bankCharter.cbMarginDebt = (c.bankCharter.cbMarginDebt ?? 0) + v;
            }
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    db.collectionMocks.interbankLoans!.insertOne.mockImplementation(async (doc: InterbankLoan) => {
      loans.push(doc);
      return { insertedId: doc._id };
    });
    db.collectionMocks.interbankLoans!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => loans.find((l) => l._id.equals(filter._id!)) ?? null
    );
    db.collectionMocks.interbankLoans!.updateOne.mockImplementation(
      async (filter: { _id?: ObjectId }, update: { $set?: Partial<InterbankLoan> }) => {
        const loan = loans.find((l) => l._id.equals(filter._id!));
        if (!loan) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(loan, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
    db.collectionMocks.interbankLoans!.deleteOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => {
        const idx = loans.findIndex((l) => l._id.equals(filter._id!));
        if (idx >= 0) loans.splice(idx, 1);
        return { deletedCount: idx >= 0 ? 1 : 0 };
      }
    );
    db.collectionMocks.interbankLoans!.aggregate.mockReturnValue({
      toArray: vi.fn().mockImplementation(async () => {
        const total = loans
          .filter((l) => l.lenderCorporationId.equals(lenderId) && l.status === "current")
          .reduce((s, l) => s + l.outstanding, 0);
        return total > 0 ? [{ total }] : [];
      }),
    });
  });

  it("caps lend amount at INTERBANK_MAX_SHARE_OF_LENDABLE × headroom", async () => {
    // headroom = 1_000_000 * 0.9 = 900_000; max share = 450_000
    const result = await lendInterbank(db as unknown as Db, lenderId, borrowerId, 450_001, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/headroom/i);
  });

  it("moves cash lender → borrower and tracks interbankDebt (not totalLoans)", async () => {
    const lenderBefore = live.get(lenderId.toString())!.bankCharter!.cashReserves!;
    const borrowerBefore = live.get(borrowerId.toString())!.bankCharter!.cashReserves!;
    const result = await lendInterbank(db as unknown as Db, lenderId, borrowerId, 100_000, 5);
    expect(result.ok).toBe(true);
    expect(live.get(lenderId.toString())!.bankCharter!.cashReserves).toBe(lenderBefore - 100_000);
    expect(live.get(borrowerId.toString())!.bankCharter!.cashReserves).toBe(
      borrowerBefore + 100_000
    );
    expect(live.get(borrowerId.toString())!.bankCharter!.interbankDebt).toBe(100_000);
    expect(live.get(lenderId.toString())!.bankCharter!.totalLoans).toBe(0);
    expect(loans).toHaveLength(1);
  });

  it("repay moves cash back and reduces debt", async () => {
    const lent = await lendInterbank(db as unknown as Db, lenderId, borrowerId, 100_000, 5);
    expect(lent.ok).toBe(true);
    if (!lent.ok) return;
    const repaid = await repayInterbank(db as unknown as Db, lent.loan._id, 40_000);
    expect(repaid.ok).toBe(true);
    expect(live.get(borrowerId.toString())!.bankCharter!.interbankDebt).toBe(60_000);
    expect(loans[0]!.outstanding).toBe(60_000);
  });

  it("ledgers both legs: lend and repay each emit a two-sided corp tx", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockClear();
    const lent = await lendInterbank(db as unknown as Db, lenderId, borrowerId, 100_000, 5);
    expect(lent.ok).toBe(true);
    if (!lent.ok) return;
    expect(emitTx).toHaveBeenCalledTimes(1);
    const [, lendEntry] = vi.mocked(emitTx).mock.calls[0]!;
    expect(lendEntry).toMatchObject({
      type: "bank_interbank_lend",
      amount: 100_000,
      counterpartyType: "corporation",
    });
    await repayInterbank(db as unknown as Db, lent.loan._id, 40_000);
    expect(emitTx).toHaveBeenCalledTimes(2);
    const [, repayEntry] = vi.mocked(emitTx).mock.calls[1]!;
    expect(repayEntry).toMatchObject({
      type: "bank_interbank_repay",
      amount: -40_000,
      counterpartyType: "corporation",
    });
  });
});

describe("CB margin draw/repay", () => {
  let db: MockDb;
  let corpId: ObjectId;
  let live: Corporation;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("corporations");
    db.collection("centralBanks");

    corpId = new ObjectId();
    live = {
      _id: corpId,
      name: "IB",
      liquidCapital: 0,
      bankCharter: makeCharter("investment", {
        propBookMarkValue: 100_000,
        cbMarginDebt: 0,
        cashReserves: 10_000,
      }),
    } as unknown as Corporation;

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
    });
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US-FED",
      primeRate: 4,
    });
    db.collectionMocks.corporations!.findOne.mockImplementation(async () => ({
      ...live,
      bankCharter: live.bankCharter ? { ...live.bankCharter } : undefined,
    }));
    db.collectionMocks.corporations!.updateOne.mockImplementation(
      async (
        filter: {
          _id?: ObjectId;
          "bankCharter.cashReserves"?: { $gte?: number };
          "bankCharter.cbMarginDebt"?: { $gte?: number };
        },
        update: { $inc?: Record<string, number> }
      ) => {
        if (
          filter["bankCharter.cashReserves"]?.$gte != null &&
          (live.bankCharter?.cashReserves ?? 0) < filter["bankCharter.cashReserves"]!.$gte!
        ) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        if (
          filter["bankCharter.cbMarginDebt"]?.$gte != null &&
          (live.bankCharter?.cbMarginDebt ?? 0) < filter["bankCharter.cbMarginDebt"].$gte
        ) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        if (update.$inc) {
          if (update.$inc["bankCharter.cashReserves"] && live.bankCharter) {
            live.bankCharter.cashReserves =
              (live.bankCharter.cashReserves ?? 0) + update.$inc["bankCharter.cashReserves"];
          }
          if (update.$inc.liquidCapital) {
            live.bankCharter!.cashReserves =
              (live.bankCharter!.cashReserves ?? 0) + update.$inc.liquidCapital;
          }
          if (update.$inc["bankCharter.cbMarginDebt"] && live.bankCharter) {
            live.bankCharter.cbMarginDebt =
              (live.bankCharter.cbMarginDebt ?? 0) + update.$inc["bankCharter.cbMarginDebt"];
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
  });

  it("caps draw at CB_MARGIN_COLLATERAL_FRACTION × prop mark", async () => {
    // max debt = 0.5 * 100_000 = 50_000
    const over = await drawCbMargin(db as unknown as Db, corpId, 50_001);
    expect(over.ok).toBe(false);
    const ok = await drawCbMargin(db as unknown as Db, corpId, 50_000);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    // Creation: liquid rises, debt rises (no CB pool debit).
    expect(live.bankCharter!.cashReserves).toBe(60_000);
    expect(live.bankCharter!.cbMarginDebt).toBe(50_000);
  });

  it("destroys cash on repay (creation/destruction symmetry)", async () => {
    await drawCbMargin(db as unknown as Db, corpId, 40_000);
    const before = live.bankCharter!.cashReserves!;
    const repaid = await repayCbMargin(db as unknown as Db, corpId, 15_000);
    expect(repaid.ok).toBe(true);
    expect(live.bankCharter!.cashReserves).toBe(before - 15_000);
    expect(live.bankCharter!.cbMarginDebt).toBe(25_000);
  });

  it("ledgers draw/repay and mirrors netMoneyCreatedLifetime on the CB", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockClear();
    db.collectionMocks.centralBanks!.updateOne.mockClear();
    await drawCbMargin(db as unknown as Db, corpId, 40_000);
    expect(emitTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitTx).mock.calls[0]![1]).toMatchObject({
      type: "bank_cb_margin_draw",
      amount: 40_000,
    });
    expect(db.collectionMocks.centralBanks!.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $inc: { netMoneyCreatedLifetime: 40_000 } })
    );
    await repayCbMargin(db as unknown as Db, corpId, 15_000);
    expect(emitTx).toHaveBeenCalledTimes(2);
    expect(vi.mocked(emitTx).mock.calls[1]![1]).toMatchObject({
      type: "bank_cb_margin_repay",
      amount: -15_000,
    });
    expect(db.collectionMocks.centralBanks!.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $inc: { netMoneyCreatedLifetime: -15_000 } })
    );
  });

  it("exports provisional constants", () => {
    expect(CB_MARGIN_SPREAD_PP).toBe(1.5);
    expect(CB_MARGIN_COLLATERAL_FRACTION).toBe(0.5);
    expect(INTERBANK_MAX_SHARE_OF_LENDABLE).toBe(0.5);
  });
});

describe("interbank default write-off via bankingTurn", () => {
  let db: MockDb;
  let lenderId: ObjectId;
  let borrowerId: ObjectId;
  let live: Map<string, Corporation>;
  let loans: InterbankLoan[];

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    for (const name of [
      "gameConfig",
      "corporations",
      "centralBanks",
      "interbankLoans",
      "characters",
      "bankLoans",
      "states",
      "depositInsuranceFunds",
      "gameState",
    ]) {
      db.collection(name);
    }

    lenderId = new ObjectId();
    borrowerId = new ObjectId();
    live = new Map([
      [
        lenderId.toString(),
        {
          _id: lenderId,
          name: "Retail",
          liquidCapital: 0,
          bankCharter: makeCharter("retail", {
            totalDeposits: 0,
            totalLoans: 0,
            lastBankingTurn: 99,
          }),
        } as unknown as Corporation,
      ],
      [
        borrowerId.toString(),
        {
          _id: borrowerId,
          name: "IB",
          liquidCapital: 0,
          bankCharter: makeCharter("investment", {
            interbankDebt: 10_000,
            lastBankingTurn: 99,
          }),
        } as unknown as Corporation,
      ],
    ]);

    loans = [
      {
        _id: new ObjectId(),
        lenderCorporationId: lenderId,
        borrowerCorporationId: borrowerId,
        currency: "USD",
        principal: 10_000,
        outstanding: 10_000,
        ratePercent: 12,
        originatedTurn: 1,
        status: "current",
        arrearsTurns: ARREARS_DEFAULT_TURNS - 1,
      },
    ];

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
    });

    // No deposit takers this turn (already stamped) → early path still services interbank.
    db.collectionMocks.corporations!.find.mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([]),
      project: vi.fn().mockReturnThis(),
    }));

    // Margin pass finds nothing.
    const findImpl = db.collectionMocks.corporations!.find.getMockImplementation();
    db.collectionMocks.corporations!.find.mockImplementation((filter?: Record<string, unknown>) => {
      if (filter?.["bankCharter.cbMarginDebt"]) {
        return {
          toArray: vi.fn().mockResolvedValue([]),
          project: vi.fn().mockReturnThis(),
        };
      }
      return findImpl
        ? findImpl(filter)
        : { toArray: vi.fn().mockResolvedValue([]), project: vi.fn().mockReturnThis() };
    });

    db.collectionMocks.corporations!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => {
        if (!filter?._id) return null;
        const c = live.get(filter._id.toString());
        return c ? { ...c, bankCharter: c.bankCharter ? { ...c.bankCharter } : undefined } : null;
      }
    );
    db.collectionMocks.corporations!.updateOne.mockImplementation(
      async (filter: { _id?: ObjectId }, update: { $inc?: Record<string, number> }) => {
        const c = filter._id ? live.get(filter._id.toString()) : undefined;
        if (!c) return { matchedCount: 0, modifiedCount: 0 };
        if (update.$inc?.liquidCapital) {
          c.liquidCapital = (c.liquidCapital ?? 0) + update.$inc.liquidCapital;
        }
        if (update.$inc?.["bankCharter.interbankDebt"] && c.bankCharter) {
          c.bankCharter.interbankDebt =
            (c.bankCharter.interbankDebt ?? 0) + update.$inc["bankCharter.interbankDebt"];
        }
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    db.collectionMocks.interbankLoans!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(loans.filter((l) => l.status === "current")),
    });
    db.collectionMocks.interbankLoans!.updateOne.mockImplementation(
      async (filter: { _id?: ObjectId }, update: { $set?: Partial<InterbankLoan> }) => {
        const loan = loans.find((l) => l._id.equals(filter._id!));
        if (!loan) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(loan, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
  });

  it("defaults after ARREARS_DEFAULT_TURNS and writes off to lender (no cash recovery)", async () => {
    const lenderCashBefore = live.get(lenderId.toString())!.bankCharter!.cashReserves!;
    const summary = await processBankingTurn(db as unknown as Db, 100);
    expect(loans[0]!.status).toBe("defaulted");
    expect(summary.interbankDefaultsWrittenOff).toBe(10_000);
    // Borrower had 0 liquid so no interest paid; lender cash unchanged on writeoff.
    expect(live.get(lenderId.toString())!.bankCharter!.cashReserves).toBe(lenderCashBefore);
    expect(live.get(borrowerId.toString())!.bankCharter!.interbankDebt).toBe(0);
  });
});
