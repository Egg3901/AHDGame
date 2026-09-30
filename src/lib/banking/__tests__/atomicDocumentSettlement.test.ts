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
  it.each([null, ["prior-receipt"]])(
    "rejects a generation changed since quote assembly before creating a claim (%j)",
    async (quotedGeneration) => {
      const memory = world();
      const db = memory as unknown as Db;
      await db
        .collection("corporations")
        .updateOne(
          { _id: id },
          { $set: { settledKeys: [...(quotedGeneration ?? []), "concurrent-book-change"] } }
        );
      const result = await settleAtomicDocumentTransition(db, transition(), {
        ...target,
        expectedSettledKeys: quotedGeneration,
      });
      expect(result.status).toBe("rejected");
      expect(await state(db)).toMatchObject({ liquidCapital: 100, bankCharter: null });
      expect(memory.collection(MONEY_MOVE_COLLECTION).docs).toHaveLength(0);
    }
  );
  it("replays the original claim with the original caller generation", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const quoted = { ...target, expectedSettledKeys: null };
    expect((await settleAtomicDocumentTransition(db, transition(), quoted)).status).toBe("applied");
    expect((await settleAtomicDocumentTransition(db, transition(), quoted)).status).toBe(
      "replayed"
    );
    expect(await state(db)).toMatchObject({ liquidCapital: 60, bankCharter: { cashReserves: 40 } });
  });
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
  it("does not revive an unwritten intent after an intervening cycle restores the same guard values", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const crash = withInjectedCrash(memory, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
    });
    await expect(
      settleAtomicDocumentTransition(crash.db, transition("old"), target)
    ).rejects.toThrow();
    await settleAtomicDocumentTransition(db, transition("new"), target);
    await db
      .collection("corporations")
      .updateOne({ _id: id }, { $set: { bankCharter: null, liquidCapital: 100 } });
    expect((await resumeSettlement(db, "old")).status).toBe("rejected");
    expect(await state(db)).toMatchObject({ liquidCapital: 100, bankCharter: null });
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

describe("atomic settlement transaction receipts", () => {
  it.each([false, true])(
    "recovers the original receipt after interruption (after=%s)",
    async (afterWrite) => {
      const memory = world();
      const db = memory as unknown as Db;
      const original = transition("receipt:one");
      const txId = new ObjectId();
      original.projections.push({
        collection: "financialTxLog",
        insert: {
          _id: oid(txId.toHexString()),
          amount: -40,
          turn: 5,
        },
        note: "immutable transaction",
      });
      const crash = withInjectedCrash(memory, {
        collection: "financialTxLog",
        op: "updateOne",
        onCall: 1,
        afterWrite,
      });
      await expect(settleAtomicDocumentTransition(crash.db, original, target)).rejects.toThrow(
        InjectedCrash
      );
      expect(await state(db)).toMatchObject({
        liquidCapital: 60,
        bankCharter: { cashReserves: 40 },
      });
      await resumeSettlement(db, original.key);
      await resumeSettlement(db, original.key);
      expect(memory.collection("financialTxLog").docs).toHaveLength(1);
      expect(await db.collection("financialTxLog").findOne({ _id: txId })).toMatchObject({
        amount: -40,
        turn: 5,
      });
      expect(await state(db)).toMatchObject({
        liquidCapital: 60,
        bankCharter: { cashReserves: 40 },
      });
    }
  );
  it("refuses a conflicting receipt without replaying the cash", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const original = transition("receipt:conflict");
    const txId = new ObjectId();
    original.projections.push({
      collection: "financialTxLog",
      insert: { _id: oid(txId.toHexString()), amount: -40 },
      note: "transaction",
    });
    memory.seed("financialTxLog", [{ _id: txId, amount: -99 }]);
    await expect(settleAtomicDocumentTransition(db, original, target)).rejects.toThrow("conflicts");
    await expect(resumeSettlement(db, original.key)).rejects.toThrow("conflicts");
    expect(await state(db)).toMatchObject({ liquidCapital: 60, bankCharter: { cashReserves: 40 } });
  });
});

describe("explicit noncash central-bank bond exchange", () => {
  const bondTarget = {
    identity,
    nonCashMode: "central_bank_bond_exchange" as const,
    guard: { publicFloat: 100, centralBankHoldings: 10 },
  };
  function exchange(key = "bond-exchange"): BankingTransition {
    return {
      key,
      kind: "monetary_bond_exchange",
      turn: 5,
      currency: "USD",
      legs: [],
      projections: [
        {
          collection: "bonds",
          filter: identity,
          update: {
            $inc: { publicFloat: -5, centralBankHoldings: 5 },
            $set: { marketPrice: 1.01, qeSupportRatio: 15 / 110 },
          },
          note: "central-bank bond inventory exchange",
        },
      ],
      event: { kind: "account.deposited", command: "monetary.qe" },
    };
  }
  function bondWorld() {
    const memory = createInMemoryDb();
    memory.seed("bonds", [{ _id: id, publicFloat: 100, centralBankHoldings: 10, marketPrice: 1 }]);
    return memory;
  }
  it("conserves units on concurrent delivery and replays the original quote", async () => {
    const memory = bondWorld(),
      db = memory as unknown as Db;
    await Promise.all([
      settleAtomicDocumentTransition(db, exchange(), bondTarget),
      settleAtomicDocumentTransition(db, exchange(), bondTarget),
    ]);
    const changed = exchange();
    changed.projections[0].update = { $inc: { publicFloat: -80, centralBankHoldings: 80 } };
    await settleAtomicDocumentTransition(db, changed, bondTarget);
    expect(memory.collection("bonds").docs[0]).toMatchObject({
      publicFloat: 95,
      centralBankHoldings: 15,
      marketPrice: 1.01,
    });
  });
  it.each([false, true])(
    "recovers the original exchange around publication (after=%s)",
    async (afterWrite) => {
      const memory = bondWorld(),
        db = memory as unknown as Db;
      const fault = withInjectedCrash(memory, {
        collection: "bonds",
        op: "updateOne",
        onCall: 1,
        afterWrite,
      });
      await expect(
        settleAtomicDocumentTransition(fault.db, exchange(), bondTarget)
      ).rejects.toThrow();
      fault.disarm();
      await resumeSettlement(db, exchange().key);
      await resumeSettlement(db, exchange().key);
      expect(memory.collection("bonds").docs[0]).toMatchObject({
        publicFloat: 95,
        centralBankHoldings: 15,
      });
      expect(memory.collection(MONEY_MOVE_COLLECTION).docs[0].status).toBe("applied");
    }
  );
  it("rejects cash updates and undeclared empty-leg operations", async () => {
    const memory = bondWorld(),
      db = memory as unknown as Db;
    const bad = exchange();
    bad.projections[0].update = { $inc: { cashLocal: 500 } };
    expect((await settleAtomicDocumentTransition(db, bad, bondTarget)).status).toBe("rejected");
    expect((await settleAtomicDocumentTransition(db, exchange(), { identity })).status).toBe(
      "rejected"
    );
    expect(memory.collection("bonds").docs[0]).not.toHaveProperty("cashLocal");
  });
  it("rejects unit creation without changing the asset", async () => {
    const memory = bondWorld(),
      db = memory as unknown as Db;
    const bad = exchange();
    bad.projections[0].update = { $inc: { publicFloat: -5, centralBankHoldings: 6 } };
    expect((await settleAtomicDocumentTransition(db, bad, bondTarget)).status).toBe("rejected");
    expect(memory.collection("bonds").docs[0]).toMatchObject({
      publicFloat: 100,
      centralBankHoldings: 10,
    });
  });
});
