import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processBankingTurn } from "../bankingTurn";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
const turn = 300;
const bank = new ObjectId();

async function world(charter: Partial<BankCharter>) {
  const memory = createInMemoryDb();
  memory.seed("gameConfig", [
    { _id: "default", privateBankingEnabled: true, bankPropTradingEnabled: true },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: turn, preset: "2019-default" }]);
  memory.seed("centralBanks", [{ _id: "US", primeRate: 4, externalBroadMoney: 0 }]);
  memory.seed("corporations", [
    {
      _id: bank,
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        cashReserves: 1000,
        lastBankingTurn: turn - 1,
        ...charter,
      },
    },
  ]);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(memory as unknown as Db);
  return memory;
}
const charterOf = (memory: Awaited<ReturnType<typeof world>>) =>
  memory.collection("corporations").docs[0].bankCharter as BankCharter;

beforeEach(() => vi.clearAllMocks());

describe("funded sovereign coupons reach realized bank income", () => {
  it("books a coupon paid before the pass once, and the next pass does not repeat it", async () => {
    const memory = await world({ sovereignCouponIncomeTotal: 10, sovereignCouponIncomeBooked: 0 });
    await processBankingTurn(memory as unknown as Db, turn);
    let charter = charterOf(memory);
    expect(charter.lastBankingIncome).toBe(10);
    expect(charter.lastBankingSovereignCoupons).toBe(10);
    expect(charter.sovereignCouponIncomeBooked).toBe(10);

    await memory
      .collection("gameState")
      .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn + 1 } });
    await processBankingTurn(memory as unknown as Db, turn + 1);
    charter = charterOf(memory);
    expect(charter.lastBankingIncome).toBe(0);
    expect(charter.lastBankingSovereignCoupons).toBe(0);
  });

  it("retains a coupon paid after the pass (BondTurn order) in the next pass", async () => {
    const memory = await world({ sovereignCouponIncomeTotal: 10, sovereignCouponIncomeBooked: 0 });
    await processBankingTurn(memory as unknown as Db, turn);
    await memory
      .collection("corporations")
      .updateOne(
        { _id: bank },
        { $inc: { "bankCharter.sovereignCouponIncomeTotal": 4, "bankCharter.cashReserves": 4 } }
      );
    await processBankingTurn(memory as unknown as Db, turn + 1);
    const charter = charterOf(memory);
    expect(charter.lastBankingIncome).toBe(4);
    expect(charter.lastBankingSovereignCoupons).toBe(4);
    expect(charter.sovereignCouponIncomeBooked).toBe(14);
  });
});
