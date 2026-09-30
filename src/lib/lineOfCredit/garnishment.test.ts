import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { garnishLocFromIncome } from "./garnishment";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
const owner = new ObjectId();
function world() {
  const db = createInMemoryDb();
  db.seed("gameConfig", [
    { _id: "default", lineOfCreditEnabled: true, forexEnabled: true, auditLog: false },
  ]);
  db.seed("gameState", [{ _id: "current", currentTurn: 12 }]);
  db.seed("characters", [
    {
      _id: owner,
      name: "Synthetic borrower",
      countryId: "US",
      lineOfCredit: { balances: { USD: 90 }, arrears: { USD: 10 }, drawFrozen: true },
      currencyBalances: { personal: { USD: 0 } },
    },
  ]);
  db.seed("centralBanks", [{ _id: "US", reserveBalance: 0 }]);
  db.seed("exchangeRates", [{ _id: "US", currencyCode: "USD", rate: 1 }]);
  return db;
}
const income = (amount = 150) =>
  new Map([[owner.toHexString(), new Map<CurrencyCode, number>([["USD", amount]])]]);
async function bind(db: ReturnType<typeof world>) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
}
describe("LOC accepted income event", () => {
  beforeEach(() => vi.clearAllMocks());
  it("joins debt and residual payout, suppressing source bulk payout on first delivery and repeat", async () => {
    const db = world();
    await bind(db);
    const first = income(),
      dividends = income(50);
    const result = await garnishLocFromIncome(db as unknown as Db, first, 12, "ceo_dividend", {
      auxiliaryPayments: [dividends],
    });
    expect(result).toEqual({ borrowersGarnished: 1, totalInternalGarnished: 100 });
    expect(first.size).toBe(0);
    expect(dividends.size).toBe(0);
    expect(db.collection("characters").docs[0]).toMatchObject({
      lineOfCredit: { balances: {}, arrears: {} },
      currencyBalances: { personal: { USD: 50 } },
    });
    // This is the actual source caller's next operation: credit remaining map.
    for (const [id, currencies] of first)
      for (const [c, amount] of currencies)
        await db
          .collection("characters")
          .updateOne(
            { _id: new ObjectId(id) },
            { $inc: { [`currencyBalances.personal.${c}`]: amount } }
          );
    await db
      .collection("characters")
      .updateOne({ _id: owner }, { $set: { "lineOfCredit.drawFrozen": false } });
    const retry = income();
    await garnishLocFromIncome(db as unknown as Db, retry, 12, "ceo_dividend", {
      auxiliaryPayments: [income(50)],
    });
    expect(retry.size).toBe(0);
    expect(db.collection("characters").docs[0]).toMatchObject({
      currencyBalances: { personal: { USD: 50 } },
    });
    expect(db.collection("centralBanks").docs[0]).toMatchObject({ reserveBalance: 10 });
    expect(db.collection("locLedger").docs).toHaveLength(1);
  });
  it("stops a changed same-turn source quote rather than paying it as new income", async () => {
    const db = world();
    await bind(db);
    await garnishLocFromIncome(db as unknown as Db, income(), 12, "bond_coupon");
    const changed = income(160);
    await expect(
      garnishLocFromIncome(db as unknown as Db, changed, 12, "bond_coupon")
    ).rejects.toThrow("income event changed");
    expect(changed.get(owner.toHexString())?.get("USD")).toBe(160);
    expect(db.collection("characters").docs[0]).toMatchObject({
      currencyBalances: { personal: { USD: 50 } },
    });
  });
  it("recovers a crash after joined payout before source map suppression", async () => {
    const db = world();
    await bind(db);
    const chars = db.collection("characters"),
      update = chars.updateOne.bind(chars);
    let fired = false;
    vi.spyOn(chars, "updateOne").mockImplementation(async (...args) => {
      const result = await update(...args);
      if (!fired) {
        fired = true;
        throw new Error("joined payout ack lost");
      }
      return result;
    });
    const first = income();
    await expect(
      garnishLocFromIncome(db as unknown as Db, first, 12, "bond_coupon")
    ).rejects.toThrow("ack lost");
    expect(first.size).toBe(1);
    await garnishLocFromIncome(db as unknown as Db, first, 12, "bond_coupon");
    expect(first.size).toBe(0);
    expect(db.collection("characters").docs[0]).toMatchObject({
      currencyBalances: { personal: { USD: 50 } },
    });
  });
});
