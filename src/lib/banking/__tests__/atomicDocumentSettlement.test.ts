import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { settleAtomicDocumentTransition } from "../atomicDocumentSettlement";
import { resumeSettlement, recoverProjections } from "../settlementJournal";
import { MONEY_MOVE_COLLECTION, resumeMoneyMove } from "../moneyMove";
import { oid, type BankingTransition } from "../rules/boundary";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const id = new ObjectId();
const identity = { _id: oid(id.toHexString()) };
const target = { identity, guard: { bankCharter: null } };
function world() {
  const memory = createInMemoryDb();
  memory.seed("corporations", [{ _id: id, liquidCapital: 100, bankCharter: null }]);
  return memory;
}
function transition(key = "charter:one"): BankingTransition {
  return {
    key,
    kind: "charter_capital",
    turn: 5,
    currency: "USD",
    legs: [
      {
        kind: "debit",
        amount: 40,
        collection: "corporations",
        filter: identity,
        path: "liquidCapital",
        note: "posted capital",
      },
      {
        kind: "credit",
        amount: 40,
        collection: "corporations",
        filter: identity,
        path: "bankCharter.cashReserves",
        note: "opening vault",
      },
    ],
    projections: [
      {
        collection: "corporations",
        filter: identity,
        update: {
          $inc: { liquidCapital: -40 },
          $set: { bankCharter: { status: "active", cashReserves: 40 } },
        },
        note: "complete charter",
      },
    ],
    event: { kind: "charter.issued", command: "bank.charter.issue" },
  };
}
async function state(db: Db) {
  return db.collection("corporations").findOne({ _id: id });
}
describe("atomic document settlement", () => {
  it("publishes capital and the complete charter together and ignores changed retry quotes", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    expect((await settleAtomicDocumentTransition(db, transition(), target)).status).toBe("applied");
    const changed = transition();
    changed.projections[0].update = { $inc: { liquidCapital: -90 } };
    expect((await settleAtomicDocumentTransition(db, changed, target)).status).toBe("replayed");
    expect(await state(db)).toMatchObject({
      liquidCapital: 60,
      bankCharter: { status: "active", cashReserves: 40 },
    });
    const receipt = await db
      .collection(MONEY_MOVE_COLLECTION)
      .findOne({ _id: transition().key as never });
    expect(receipt?.legs).toMatchObject([{ applied: true }, { applied: true }]);
    expect(receipt?.projections).toMatchObject([{ applied: true }]);
  });
  it.each([false, true])(
    "recovers a crash around the single document write (after=%s)",
    async (afterWrite) => {
      const memory = world();
      const db = memory as unknown as Db;
      const crash = withInjectedCrash(memory, {
        collection: "corporations",
        op: "updateOne",
        onCall: 1,
        afterWrite,
      });
      await expect(settleAtomicDocumentTransition(crash.db, transition(), target)).rejects.toThrow(
        InjectedCrash
      );
      expect((await resumeMoneyMove(db, transition().key)).status).toBe("rejected");
      await resumeSettlement(db, transition().key);
      await recoverProjections(db, transition().key);
      expect(await state(db)).toMatchObject({
        liquidCapital: 60,
        bankCharter: { status: "active", cashReserves: 40 },
      });
    }
  );
  it("refuses a stale concurrent charter without any separate debit", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const results = await Promise.all([
      settleAtomicDocumentTransition(db, transition("first"), target),
      settleAtomicDocumentTransition(db, transition("second"), target),
    ]);
    expect(results.filter((result) => result.status === "applied")).toHaveLength(1);
    expect(await state(db)).toMatchObject({ liquidCapital: 60, bankCharter: { cashReserves: 40 } });
  });
  it("does not republish an old charter after its write landed and a later revoke/reissue", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const crash = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleAtomicDocumentTransition(crash.db, transition(), target)).rejects.toThrow();
    await db.collection("corporations").updateOne(
      { _id: id },
      {
        $set: {
          bankCharter: { status: "active", cashReserves: 7, charteredTurn: 9 },
          liquidCapital: 93,
        },
      }
    );
    await resumeSettlement(db, transition().key);
    expect(await state(db)).toMatchObject({
      liquidCapital: 93,
      bankCharter: { cashReserves: 7, charteredTurn: 9 },
    });
  });
  it("supports a mint and atomic cash/debt publication, then burn and cash retirement", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const mint = transition("mint");
    mint.legs = [
      { kind: "mint", amount: 40, note: "facility creation" },
      { ...mint.legs[0], kind: "credit" },
    ];
    mint.projections[0].update = { $inc: { liquidCapital: 40, debt: 40 } };
    expect((await settleAtomicDocumentTransition(db, mint, { identity })).status).toBe("applied");
    const burn = transition("burn");
    burn.legs = [burn.legs[0], { kind: "burn", amount: 40, note: "facility retirement" }];
    burn.projections[0].update = { $inc: { liquidCapital: -40, debt: -40 } };
    expect((await settleAtomicDocumentTransition(db, burn, { identity })).status).toBe("applied");
    expect(await state(db)).toMatchObject({ liquidCapital: 100, debt: 0 });
  });
  it("rejects a projection that would erase existing vault cash", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    await db
      .collection("corporations")
      .updateOne({ _id: id }, { $set: { bankCharter: { status: "revoked", cashReserves: 5 } } });
    expect((await settleAtomicDocumentTransition(db, transition(), { identity })).status).toBe(
      "rejected"
    );
    expect(await state(db)).toMatchObject({ liquidCapital: 100, bankCharter: { cashReserves: 5 } });
  });
});
