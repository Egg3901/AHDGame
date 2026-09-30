import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { settleLocPlan, type LocPlan } from "./settlement";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
const owner = new ObjectId();
function fixture() {
  const db = createInMemoryDb();
  db.seed("characters", [
    {
      _id: owner,
      lineOfCredit: { balances: { USD: 100 }, arrears: { USD: 10 }, accountsOpened: { USD: true } },
      currencyBalances: { personal: { USD: 200 } },
    },
  ]);
  db.seed("centralBanks", [{ _id: "US", reserveBalance: 0 }]);
  db.seed("gameConfig", [{ _id: "default", auditLog: false }]);
  return db;
}
function quote(): LocPlan {
  return {
    characterId: owner,
    expectedLoc: { balances: { USD: 100 }, arrears: { USD: 10 }, accountsOpened: { USD: true } },
    expectedRevision: null,
    request: { operation: "repay", amount: 50, currency: "USD" },
    createdAt: new Date("2026-09-30T00:00:00Z"),
    effect: {
      locAfter: { balances: { USD: 60 }, arrears: {}, accountsOpened: { USD: true } },
      walletInc: { "currencyBalances.personal.USD": -50 },
      reserves: [{ bankId: "US", increments: { reserveBalance: 10 } }],
      ledger: [
        {
          characterId: owner,
          countryId: "US",
          currencyCode: "USD",
          type: "repay",
          amount: 50,
          principalPortion: 40,
          interestPortion: 10,
          balanceAfter: 60,
          arrearsAfter: 0,
          turn: 5,
        },
      ],
      transactions: [],
      flows: [
        { currency: "USD", kind: "debit", amount: 50, note: "wallet" },
        { currency: "USD", kind: "credit", amount: 10, note: "interest" },
        { currency: "USD", kind: "burn", amount: 40, note: "principal" },
      ],
      result: { success: true, amount: 50 },
    },
  };
}
describe("LOC original settlement", () => {
  it("settles cash, debt and revenue once under concurrent delivery and replay", async () => {
    const db = fixture();
    const results = await Promise.all([
      settleLocPlan(db as unknown as Db, "loc-test", 5, quote()),
      settleLocPlan(db as unknown as Db, "loc-test", 5, quote()),
    ]);
    expect(results.every((r) => !r.error)).toBe(true);
    await settleLocPlan(db as unknown as Db, "loc-test", 5, quote());
    expect(db.collection("characters").docs[0]).toMatchObject({
      currencyBalances: { personal: { USD: 150 } },
      lineOfCredit: { balances: { USD: 60 }, arrears: {} },
    });
    expect(db.collection("centralBanks").docs[0]).toMatchObject({ reserveBalance: 10 });
    expect(db.collection("locLedger").docs).toHaveLength(1);
  });
  it("rejects another operation using a consumed quote or an existing identity", async () => {
    const db = fixture();
    await settleLocPlan(db as unknown as Db, "first", 5, quote());
    const stale = await settleLocPlan(db as unknown as Db, "second", 5, quote());
    expect(stale.status).toBe("rejected");
    const changed = quote();
    changed.request.amount = 60;
    await expect(settleLocPlan(db as unknown as Db, "first", 5, changed)).rejects.toThrow(
      "different request"
    );
    expect(db.collection("characters").docs[0]).toMatchObject({
      currencyBalances: { personal: { USD: 150 } },
    });
  });
  it.each(["character", "reserve", "ledger"])(
    "recovers lost %s acknowledgement without repeating cash or ledger",
    async (point) => {
      const db = fixture();
      const target = db.collection(
        point === "character" ? "characters" : point === "reserve" ? "centralBanks" : "locLedger"
      );
      const update = target.updateOne.bind(target);
      let fired = false;
      vi.spyOn(target, "updateOne").mockImplementation(async (...args) => {
        const result = await update(...args);
        const updateSpec = args[1];
        const increments =
          !Array.isArray(updateSpec) && "$inc" in updateSpec ? updateSpec.$inc : undefined;
        const mutation =
          point === "ledger" ||
          (increments &&
            Object.keys(increments).some(
              (path) => path.startsWith("currencyBalances.") || path === "reserveBalance"
            ));
        if (!fired && mutation) {
          fired = true;
          throw new Error("lost acknowledgement");
        }
        return result;
      });
      await expect(settleLocPlan(db as unknown as Db, "crash", 5, quote())).rejects.toThrow(
        "lost acknowledgement"
      );
      await settleLocPlan(db as unknown as Db, "crash", 5, quote());
      expect(db.collection("characters").docs[0]).toMatchObject({
        currencyBalances: { personal: { USD: 150 } },
        lineOfCredit: { balances: { USD: 60 } },
      });
      expect(db.collection("centralBanks").docs[0]).toMatchObject({ reserveBalance: 10 });
      expect(db.collection("locLedger").docs).toHaveLength(1);
    }
  );
  it.each(["characters", "centralBanks"])(
    "survives %s receipt eviction before acknowledgement",
    async (collection) => {
      const db = fixture();
      const target = db.collection(collection);
      const update = target.updateOne.bind(target);
      let fired = false;
      vi.spyOn(target, "updateOne").mockImplementation(async (...args) => {
        const result = await update(...args);
        const spec = args[1];
        const inc = !Array.isArray(spec) && "$inc" in spec ? spec.$inc : undefined;
        if (
          !fired &&
          inc &&
          Object.keys(inc).some(
            (path) => path.startsWith("currencyBalances.") || path === "reserveBalance"
          )
        ) {
          fired = true;
          throw new Error("cash acknowledgement lost");
        }
        return result;
      });
      await expect(settleLocPlan(db as unknown as Db, "evicted", 5, quote())).rejects.toThrow(
        "acknowledgement lost"
      );
      await target.updateOne(
        { _id: collection === "characters" ? owner : "US" },
        {
          $set: {
            settledKeys: Array.from({ length: 200 }, (_, i) => `unrelated-${i}`),
          },
        }
      );
      await Promise.all([
        settleLocPlan(db as unknown as Db, "evicted", 5, quote()),
        settleLocPlan(db as unknown as Db, "evicted", 5, quote()),
      ]);
      expect(db.collection("characters").docs[0]).toMatchObject({
        currencyBalances: { personal: { USD: 150 } },
        lineOfCredit: { balances: { USD: 60 } },
      });
      expect(db.collection("centralBanks").docs[0]).toMatchObject({ reserveBalance: 10 });
      expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
    }
  );
  it("a delayed original writer cannot repeat cash or reject a completed retry after receipt eviction", async () => {
    const db = fixture();
    const target = db.collection("characters");
    const update = target.updateOne.bind(target);
    let release!: () => void, reached!: () => void;
    const paused = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    vi.spyOn(target, "updateOne").mockImplementation(async (...args) => {
      const spec = args[1];
      const inc = !Array.isArray(spec) && "$inc" in spec ? spec.$inc : undefined;
      if (!held && inc && Object.keys(inc).some((path) => path.startsWith("currencyBalances."))) {
        held = true;
        reached();
        await resume;
      }
      return update(...args);
    });
    const first = settleLocPlan(db as unknown as Db, "delayed", 5, quote());
    await paused;
    try {
      expect(
        (await settleLocPlan(db as unknown as Db, "delayed", 5, quote())).error
      ).toBeUndefined();
      const settledKeys = Array.from({ length: 200 }, (_, i) => `replacement-${i}`);
      await target.updateOne({ _id: owner }, { $set: { settledKeys } });
      await db.collection("centralBanks").updateOne({ _id: "US" }, { $set: { settledKeys } });
    } finally {
      release();
    }
    expect((await first).error).toBeUndefined();
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
    expect(target.docs[0]).toMatchObject({
      currencyBalances: { personal: { USD: 150 } },
      lineOfCredit: { balances: { USD: 60 } },
    });
    expect(db.collection("centralBanks").docs[0]).toMatchObject({ reserveBalance: 10 });
    expect(db.collection("locLedger").docs).toHaveLength(1);
  });
});
