import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { cancelConversionUnderwriting } from "./cancelConversionUnderwriting";
import { MONEY_MOVE_COLLECTION, legStamp } from "./moneyMove";
import { projectionStamp, resumeSettlement } from "./settlementJournal";
vi.mock("@/lib/db/sessionDb", () => ({ boundSession: () => ({}) }));
vi.mock("./settlementJournal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settlementJournal")>()),
  resumeSettlement: vi.fn().mockResolvedValue({ status: "applied" }),
}));
function world(appliedCount: number, lostAck = false) {
  const memory = createInMemoryDb();
  const bank = new ObjectId(),
    issuer = new ObjectId(),
    instrument = new ObjectId();
  const key = "primary-underwriting:synthetic:100";
  memory.seed("corporations", [
    {
      _id: bank,
      bankCharter: { cashReserves: 1000 + (appliedCount >= 3 ? 15 : 0) },
      bankUnderwritingFunding: {
        key,
        issuerCorporationId: issuer,
        currencyCode: "GBP",
        grossLocal: 1000,
        poolCollection: "bondMarketPools",
      },
      ...(lostAck && appliedCount >= 3
        ? { pendingMoneyMoveReceipt: { key, index: 2, outcome: "applied" } }
        : {}),
    },
    {
      _id: issuer,
      liquidCapital: 2000 + (appliedCount >= 2 ? 985 : 0),
      primaryUnderwritingIncomingFunding: { key },
      ...(lostAck && appliedCount >= 2 ? { settledKeys: [legStamp(key, 1)] } : {}),
    },
  ]);
  memory.seed("bondMarketPools", [
    {
      _id: "GBP",
      cashLocal: 10000 - (appliedCount >= 1 ? 1000 : 0),
      lifetime: { issuanceOut: 0 },
      ...(lostAck && appliedCount >= 1
        ? { pendingMoneyMoveReceipt: { key, index: 0, outcome: "applied" } }
        : {}),
    },
  ]);
  memory.seed("bonds", [
    {
      _id: instrument,
      totalIssued: 5000,
      publicFloat: 10,
      unsoldUnits: 20,
      holders: [{ ownerId: "existing", units: 40 }],
    },
  ]);
  memory.seed(MONEY_MOVE_COLLECTION, [
    {
      _id: key,
      kind: "bank.primary_underwriting",
      status: "partial",
      legs: [
        {
          kind: "debit",
          collection: "bondMarketPools",
          filter: { _id: "GBP" },
          path: "cashLocal",
          amount: 1000,
          applied: !lostAck && appliedCount >= 1,
        },
        {
          kind: "credit",
          collection: "corporations",
          filter: { _id: issuer },
          path: "liquidCapital",
          amount: 985,
          applied: !lostAck && appliedCount >= 2,
        },
        {
          kind: "credit",
          collection: "corporations",
          filter: { _id: bank },
          path: "bankCharter.cashReserves",
          amount: 15,
          applied: !lostAck && appliedCount >= 3,
        },
      ],
      projections: [
        { projection: { collection: "bondMarketPools", filter: { _id: "GBP" } } },
        { projection: { collection: "bonds", filter: { _id: instrument } } },
      ],
    },
  ]);
  return { db: memory as unknown as Db, memory, bank, issuer, instrument, key };
}
describe("conversion underwriting receipt refunds", () => {
  it.each([0, 1, 2, 3])(
    "reverses exactly %s delivered cash legs and cannot refund twice",
    async (count) => {
      const w = world(count);
      await cancelConversionUnderwriting(w.db, [w.issuer], 101);
      await cancelConversionUnderwriting(w.db, [w.issuer], 102);
      expect(await w.db.collection("corporations").findOne({ _id: w.issuer })).toMatchObject({
        liquidCapital: 2000,
      });
      expect(await w.db.collection("corporations").findOne({ _id: w.bank })).toMatchObject({
        bankCharter: { cashReserves: 1000 },
      });
      expect(
        await w.db.collection("bondMarketPools").findOne({ _id: "GBP" } as never)
      ).toMatchObject({ cashLocal: 10000 });
      expect(await w.db.collection("bonds").findOne({ _id: w.instrument })).toMatchObject({
        totalIssued: 5000,
        publicFloat: 10,
        unsoldUnits: 20,
        holders: [{ ownerId: "existing", units: 40 }],
      });
      expect(
        (await w.db.collection(MONEY_MOVE_COLLECTION).findOne({ _id: w.key } as never))?.status
      ).toBe("rejected");
    }
  );
  it("clears a stale lease for an already cancelled empty journal", async () => {
    const w = world(0);
    await w.db.collection(MONEY_MOVE_COLLECTION).updateOne({ _id: w.key } as never, {
      $set: { conversionRefundTurn: 100, projections: [], legs: [] },
    });
    await cancelConversionUnderwriting(w.db, [w.issuer], 101);
    expect(
      (await w.db.collection("corporations").findOne({ _id: w.bank }))?.bankUnderwritingFunding
    ).toBeUndefined();
  });
  it("recognizes cash receipts whose journal ACK was lost", async () => {
    const w = world(3, true);
    await cancelConversionUnderwriting(w.db, [w.issuer], 101);
    expect(await w.db.collection("corporations").findOne({ _id: w.issuer })).toMatchObject({
      liquidCapital: 2000,
    });
    expect(await w.db.collection("corporations").findOne({ _id: w.bank })).toMatchObject({
      bankCharter: { cashReserves: 1000 },
    });
    expect(w.memory.collection("bondMarketPools").docs[0].cashLocal).toBe(10000);
  });
  it("reverses the pool issuance ledger even when its projection ACK was lost", async () => {
    const w = world(3);
    await w.db.collection("bondMarketPools").updateOne({ _id: "GBP" } as never, {
      $set: { "lifetime.issuanceOut": 1000, settledKeys: [projectionStamp(w.key, 0)] },
    });
    await cancelConversionUnderwriting(w.db, [w.issuer], 101);
    expect(w.memory.collection("bondMarketPools").docs[0].lifetime).toEqual({ issuanceOut: 0 });
  });
  it("finishes a published placement without reversing cash or issued units", async () => {
    const w = world(3);
    await w.db
      .collection("bonds")
      .updateOne({ _id: w.instrument }, { $set: { settledKeys: [projectionStamp(w.key, 1)] } });
    await cancelConversionUnderwriting(w.db, [w.issuer], 101);
    expect(resumeSettlement).toHaveBeenCalledWith(w.db, w.key);
    expect(w.memory.collection("bondMarketPools").docs[0].cashLocal).toBe(9000);
  });
  it("leaves unrelated funding receipts untouched", async () => {
    const w = world(3);
    await cancelConversionUnderwriting(w.db, [new ObjectId()], 101);
    expect(w.memory.collection("bondMarketPools").docs[0].cashLocal).toBe(9000);
  });
});
