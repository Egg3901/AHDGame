import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter } from "@/lib/db/types/bank";
import {
  getCashReserves,
  injectBankCapital,
  requiredReserves,
  upstreamBankCash,
  upstreamCapacity,
} from "../bankCash";

function charter(over: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 100_000,
    cashReserves: 500_000,
    depositOffset: 0,
    lendingOffset: 0,
    totalDeposits: 1_000_000,
    // 500k cash + 800k loans − 1M deposits = 200k equity: enough that the
    // reserve requirement, not equity, is the binding ceiling on the default
    // fixture. Equity-bound cases set their own numbers.
    totalLoans: 800_000,
    capitalStanding: "adequate",
    ...over,
  } as BankCharter;
}

describe("reserve arithmetic", () => {
  it("treats a charter written before the ring-fence as holding nothing", () => {
    expect(getCashReserves(charter({ cashReserves: undefined }))).toBe(0);
    expect(getCashReserves(undefined)).toBe(0);
    expect(getCashReserves(charter({ cashReserves: Number.NaN }))).toBe(0);
  });

  it("requires the ratio against deposits", () => {
    expect(requiredReserves(charter(), 0.2)).toBe(200_000);
    expect(requiredReserves(charter({ totalDeposits: 0 }), 0.2)).toBe(0);
  });

  it("offers only the surplus over the requirement", () => {
    // 500k held, 200k required.
    expect(upstreamCapacity(charter(), 0.2)).toBe(300_000);
  });

  it("offers nothing when the whole balance is required", () => {
    expect(upstreamCapacity(charter({ cashReserves: 150_000 }), 0.2)).toBe(0);
  });

  it("offers nothing from a bank the supervisor has not cleared", () => {
    // The same rule the prop desk answers to. A bank that cannot survive the
    // published shock does not get to pay its owner in the meantime.
    expect(upstreamCapacity(charter({ capitalStanding: "stressed" }), 0.2)).toBe(0);
    expect(upstreamCapacity(charter({ capitalStanding: "undercapitalized" }), 0.2)).toBe(0);
  });

  it("caps the payout at book equity, not just the reserve surplus", () => {
    // Reserves sit well above the 20% requirement, but the deposits they back
    // are not the owner's money. Equity = 500k cash + 100k loans − 1M deposits
    // = −400k, so nothing may be upstreamed even though 300k looks 'surplus'.
    expect(upstreamCapacity(charter({ totalLoans: 100_000 }), 0.2)).toBe(0);
    // With loans covering more of the deposit liability the owner has real
    // equity: 500k + 850k − 1M = 350k, but only the 300k reserve surplus fits.
    expect(upstreamCapacity(charter({ totalLoans: 850_000 }), 0.2)).toBe(300_000);
    // Equity below the reserve surplus becomes the binding ceiling: 500k + 700k
    // − 1M = 200k < 300k surplus.
    expect(upstreamCapacity(charter({ totalLoans: 700_000 }), 0.2)).toBe(200_000);
  });

  it("counts borrowed cash as a liability, not distributable capital", () => {
    // A bank that drew emergency liquidity holds the cash but owes it back;
    // upstreaming it would hand the owner the central bank's money. 500k cash +
    // 800k loans − (1M deposits + 300k window) = 0 equity.
    expect(upstreamCapacity(charter({ discountWindowDebt: 300_000 }), 0.2)).toBe(0);
    expect(upstreamCapacity(charter({ interbankDebt: 300_000 }), 0.2)).toBe(0);
    expect(upstreamCapacity(charter({ cbMarginDebt: 300_000 }), 0.2)).toBe(0);
  });

  it("blocks extraction from an NPC-deposit-inflated reserve base (ticket #1088)", () => {
    // The Hagemeyer case: a days-old retail bank handed a ~1.3B NPC deposit
    // base, ~1.02B reserves, 124M loans. Reserve surplus looks like hundreds of
    // millions, but book equity is negative — none of it is the owner's.
    const hagemeyer = charter({
      cashReserves: 1_020_159_685,
      totalDeposits: 1_303_882_142,
      totalLoans: 124_295_401,
    });
    expect(upstreamCapacity(hagemeyer, 0.1)).toBe(0);
  });
});

describe("injectBankCapital", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
  });

  it("moves cash across in one atomic write and books the memo", async () => {
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 900_000,
      bankCharter: charter({ cashReserves: 600_000, postedCapital: 200_000 }),
    });

    const result = await injectBankCapital(db as unknown as Db, corpId, 100_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cashReserves).toBe(600_000);

    const [filter, update] = db.collectionMocks.corporations!.findOneAndUpdate.mock.calls[0];
    // Both balances move in the same document update: the transfer cannot
    // half-apply, which matters because standalone Mongo has no transactions.
    expect(update.$inc).toEqual({
      liquidCapital: -100_000,
      "bankCharter.cashReserves": 100_000,
      "bankCharter.postedCapital": 100_000,
    });
    expect(filter.liquidCapital).toEqual({ $gte: 100_000 });
    expect(filter["bankCharter.status"]).toBe("active");
  });

  it("is capped only by the corporation's cash — no supervisory gate inbound", async () => {
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 0,
      bankCharter: charter({ capitalStanding: "undercapitalized", cashReserves: 1_000_000 }),
    });
    // An undercapitalized bank is exactly the one that most needs capital, so
    // the inbound direction must not refuse it.
    const result = await injectBankCapital(db as unknown as Db, corpId, 500_000);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-positive amount without touching the database", async () => {
    for (const bad of [0, -1, Number.NaN]) {
      const result = await injectBankCapital(db as unknown as Db, corpId, bad);
      expect(result.ok).toBe(false);
    }
    expect(db.collectionMocks.corporations!.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("upstreamBankCash", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
  });

  function mockBank(over: Partial<BankCharter> = {}) {
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: corpId,
      liquidCapital: 0,
      bankCharter: charter(over),
    });
    db.collectionMocks.corporations!.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 300_000,
      bankCharter: charter({ ...over, cashReserves: 200_000 }),
    });
  }

  it("pays out the surplus and re-gates the requirement inside the write", async () => {
    mockBank();
    const result = await upstreamBankCash(db as unknown as Db, corpId, 300_000, 0.2);
    expect(result.ok).toBe(true);

    const [filter, update] = db.collectionMocks.corporations!.findOneAndUpdate.mock.calls[0];
    expect(update.$inc.liquidCapital).toBe(300_000);
    expect(update.$inc["bankCharter.cashReserves"]).toBe(-300_000);
    // The read above can go stale against a concurrent injection or a banking
    // turn moving deposits; the one thing this must never do is leave the bank
    // short, so the requirement is re-checked atomically.
    expect(JSON.stringify(filter.$expr)).toContain("bankCharter.cashReserves");
  });

  it("clamps to the surplus rather than paying what was asked", async () => {
    mockBank();
    const result = await upstreamBankCash(db as unknown as Db, corpId, 999_999_999, 0.2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amount).toBe(300_000);
  });

  it("refuses a bank that failed its stress test", async () => {
    mockBank({ capitalStanding: "stressed" });
    const result = await upstreamBankCash(db as unknown as Db, corpId, 1_000, 0.2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/stress test/i);
    expect(db.collectionMocks.corporations!.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("tells an undercapitalized bank to post capital rather than take it", async () => {
    mockBank({ capitalStanding: "undercapitalized" });
    const result = await upstreamBankCash(db as unknown as Db, corpId, 1_000, 0.2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/undercapitalized/i);
  });

  it("refuses when every penny is required against deposits", async () => {
    mockBank({ cashReserves: 200_000 });
    const result = await upstreamBankCash(db as unknown as Db, corpId, 1_000, 0.2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no distributable capital/i);
  });

  it("refuses to pay the owner out of an NPC-deposit-inflated reserve base", async () => {
    // Negative book equity despite reserves far above the requirement: the
    // exploit path from ticket #1088 must not reach the write.
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: corpId,
      liquidCapital: 0,
      bankCharter: charter({
        cashReserves: 1_020_159_685,
        totalDeposits: 1_303_882_142,
        totalLoans: 124_295_401,
      }),
    });
    const result = await upstreamBankCash(db as unknown as Db, corpId, 100_000_000, 0.1);
    expect(result.ok).toBe(false);
    expect(db.collectionMocks.corporations!.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("never books negative contributed capital when paying out earnings", async () => {
    // 500k held against 100k ever posted: the bank earned the rest, and paying
    // it out must not drive the memo below zero.
    mockBank({ postedCapital: 100_000 });
    await upstreamBankCash(db as unknown as Db, corpId, 300_000, 0.2);
    const [, update] = db.collectionMocks.corporations!.findOneAndUpdate.mock.calls[0];
    expect(update.$inc["bankCharter.postedCapital"]).toBe(-100_000);
  });
});
