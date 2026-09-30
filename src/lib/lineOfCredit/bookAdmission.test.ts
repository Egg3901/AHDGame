import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { acquireLocBookAdmission, releaseLocBookAdmission } from "./bookAdmission";
import { settleLocPlan, type LocPlan } from "./settlement";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
const snapshot = vi.hoisted(() => ({ available: 100, calls: 0 }));
vi.mock("./buildSnapshot", () => ({
  buildLocSnapshot: vi.fn(async () => {
    snapshot.calls++;
    return { perPlayerAvailableInternal: snapshot.available };
  }),
}));
const id = new ObjectId();
function fixture() {
  const db = createInMemoryDb();
  db.seed("centralBanks", [{ _id: "US", reserveBalance: 1000 }]);
  db.seed("characters", [
    {
      _id: id,
      lineOfCredit: { balances: {}, accountsOpened: { USD: true } },
      currencyBalances: { personal: { USD: 1000 } },
    },
  ]);
  db.seed("gameConfig", [{ _id: "default" }]);
  snapshot.available = 100;
  snapshot.calls = 0;
  return db;
}
function plan(): LocPlan {
  return {
    characterId: id,
    expectedRevision: null,
    expectedLoc: { balances: {}, accountsOpened: { USD: true } },
    request: { operation: "draw", currency: "USD", amount: 100 },
    drawAdmission: { bankId: "US", addInternal: 100, exchangeRate: 1 },
    createdAt: new Date("2026-09-30T00:00:00Z"),
    effect: {
      locAfter: { balances: { USD: 100 }, accountsOpened: { USD: true } },
      walletInc: { "currencyBalances.personal.USD": 100 },
      reserves: [],
      ledger: [],
      transactions: [],
      flows: [
        { currency: "USD", kind: "mint", amount: 100, note: "draw" },
        { currency: "USD", kind: "credit", amount: 100, note: "wallet" },
      ],
      result: { success: true },
    },
  };
}
describe("recoverable LOC debt-book admission", () => {
  it("excludes another writer, advances revision and never reacquires a completed command", async () => {
    const db = fixture();
    const native = db as unknown as Db;
    await acquireLocBookAdmission(native, "first", plan());
    await expect(acquireLocBookAdmission(native, "second", plan())).rejects.toThrow("busy");
    expect(db.collection("centralBanks").docs[0]).toMatchObject({
      locBookRevision: 1,
      pendingLocBookMutationId: "first",
    });
    await releaseLocBookAdmission(native, "first", plan());
    await acquireLocBookAdmission(native, "first", plan());
    expect(db.collection("centralBanks").docs[0]).toMatchObject({ locBookRevision: 2 });
    expect(db.collection("centralBanks").docs[0].pendingLocBookMutationId).toBeUndefined();
  });
  it("rejects an original draw whose current capacity is lower and releases its admission", async () => {
    const db = fixture();
    snapshot.available = 50;
    const result = await settleLocPlan(db as unknown as Db, "declined", 1, plan());
    expect(result.status).toBe("rejected");
    expect(db.collection("characters").docs[0].currencyBalances.personal.USD).toBe(1000);
    expect(db.collection("centralBanks").docs[0].pendingLocBookMutationId).toBeUndefined();
    snapshot.available = 1000;
    expect((await settleLocPlan(db as unknown as Db, "declined", 1, plan())).status).toBe(
      "rejected"
    );
  });
  it.each(["admission", "character", "release"])(
    "recovers a lost %s acknowledgement without new underwriting or cash",
    async (point) => {
      const db = fixture();
      const native = db as unknown as Db;
      const target = db.collection(point === "character" ? "characters" : "centralBanks");
      const update = target.updateOne.bind(target);
      let fired = false;
      vi.spyOn(target, "updateOne").mockImplementation(async (...args) => {
        const result = await update(...args);
        const matches =
          point !== "release" || Object.hasOwn(args[1].$unset ?? {}, "pendingLocBookMutationId");
        if (!fired && matches) {
          fired = true;
          throw new Error("lost acknowledgement");
        }
        return result;
      });
      await expect(settleLocPlan(native, "recover", 1, plan())).rejects.toThrow(
        "lost acknowledgement"
      );
      await settleLocPlan(native, "recover", 1, plan());
      await settleLocPlan(native, "recover", 1, plan());
      expect(db.collection("characters").docs[0].currencyBalances.personal.USD).toBe(1100);
      expect(db.collection("centralBanks").docs[0].pendingLocBookMutationId).toBeUndefined();
      expect(db.collection("centralBanks").docs[0].locBookRevision).toBe(2);
      expect(snapshot.calls).toBe(1);
    }
  );
  it("admits contractual interest without applying a new borrowing cap", async () => {
    const db = fixture();
    snapshot.available = -1;
    const service = plan();
    delete service.drawAdmission;
    service.request.operation = "service";
    service.effect.walletInc = {};
    service.effect.flows = [];
    await settleLocPlan(db as unknown as Db, "service", 1, service);
    expect(snapshot.calls).toBe(0);
    expect(db.collection("characters").docs[0].lineOfCredit.balances.USD).toBe(100);
  });
});
