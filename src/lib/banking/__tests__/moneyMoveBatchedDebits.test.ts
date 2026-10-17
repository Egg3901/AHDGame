import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { applyMoneyMove, resumeMoneyMove, type MoneyMove } from "../moneyMove";

import { settleTransition } from "../settlementJournal";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function fixture(count = 40) {
  const memory = createInMemoryDb();
  memory.seed("accounts", [
    ...Array.from({ length: count }, (_, i) => ({ _id: `payer:${i}`, balance: 100 })),
    { _id: "recipient", balance: 0 },
  ]);
  const move: MoneyMove = {
    key: "funded-producers:1",
    kind: "funded-producers",
    record: { batchIndependentDebits: true },
    legs: [
      ...Array.from({ length: count }, (_, i) => ({
        kind: "debit" as const,
        collection: "accounts",
        filter: { _id: `payer:${i}` },
        path: "balance",
        amount: 10,
        note: "Funded purchase",
      })),
      {
        kind: "credit",
        collection: "accounts",
        filter: { _id: "recipient" },
        path: "balance",
        amount: count * 10,
        note: "Paid delivery",
      },
    ],
  };
  const calls: Record<string, number> = {};
  const db = new Proxy(memory, {
    get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver);
      return (name: string) => {
        const collection = target.collection(name);
        return new Proxy(collection, {
          get(c, method, r) {
            const value = Reflect.get(c, method, r);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              calls[String(method)] = (calls[String(method)] ?? 0) + 1;
              return value.apply(c, args);
            };
          },
        });
      };
    },
  }) as unknown as Db;
  const balance = (id: string) =>
    Number(memory.collection("accounts").docs.find((row) => String(row._id) === id)!.balance);
  return { memory, db, move, calls, balance };
}

describe("independent debit batches", () => {
  it("settles many independently funded purchases in a bounded number of database calls", async () => {
    const f = fixture();
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    expect(Object.values(f.calls).reduce((sum, value) => sum + value, 0)).toBeLessThan(35);
    expect(f.balance("recipient")).toBe(400);
    for (let i = 0; i < 40; i++) expect(f.balance(`payer:${i}`)).toBe(90);
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    expect(f.balance("recipient")).toBe(400);
  });

  it.each([false, true])(
    "pins the debit batch protocol through the journal, ObjectId targets=%s",
    async (objectIds) => {
      const f = fixture();
      let recipient = "recipient";
      if (objectIds) {
        const rows = f.memory.collection("accounts").docs;
        const ids = new Map(rows.map((row) => [String(row._id), new ObjectId()]));
        for (const row of rows) row._id = ids.get(String(row._id))!;
        for (const leg of f.move.legs)
          leg.filter = { _id: { $oid: ids.get(String(leg.filter!._id))!.toHexString() } };
        recipient = ids.get("recipient")!.toHexString();
      }
      const settled = await settleTransition(f.db, {
        key: f.move.key,
        kind: f.move.kind,
        currency: "USD",
        turn: 1,
        legs: f.move.legs,
        batchIndependentDebits: true,
        projections: [],
        event: { kind: "monetary.executed", command: "producer.settle" },
      });
      expect(settled.status).toBe("applied");
      expect(f.memory.collection("bankMoneyMoves").docs[0].batchIndependentDebits).toBe(true);
      expect(f.calls.bulkWrite).toBeGreaterThanOrEqual(2);
      expect(Object.values(f.calls).reduce((sum, value) => sum + value, 0)).toBeLessThan(50);
      expect(f.balance(recipient)).toBe(400);
    }
  );

  it("retains individual debit execution unless the original claim opts in", async () => {
    const f = fixture(8);
    f.move.record = {};
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    expect(f.calls.bulkWrite ?? 0).toBe(0);
  });

  it("never pays a credit when a debit guard fails", async () => {
    const f = fixture(8);
    f.memory.collection("accounts").docs.find((row) => row._id === "payer:3")!.balance = 0;
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("partial");
    expect(f.balance("recipient")).toBe(0);
    expect(f.balance("payer:3")).toBe(0);
    expect(f.balance("payer:7")).toBe(90);
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("partial");
    expect(f.balance("payer:7")).toBe(90);
  });

  it("keeps repeated targets on individual execution", async () => {
    const f = fixture(8);
    f.move.legs.splice(1, 0, { ...f.move.legs[0], amount: 2 });
    f.move.legs.at(-1)!.amount += 2;
    expect((await applyMoneyMove(f.db, f.move)).status).toBe("applied");
    expect(f.calls.bulkWrite ?? 0).toBe(0);
    expect(f.balance("payer:0")).toBe(88);
  });

  it("finishes a partial bulk delivery from each target's surviving receipt", async () => {
    const f = fixture(8);
    const accounts = f.memory.collection("accounts");
    const write = accounts.bulkWrite.bind(accounts);
    vi.spyOn(accounts, "bulkWrite").mockImplementationOnce(async (writes) => {
      await write(writes.slice(0, 2));
      throw new Error("Interrupted after two debits");
    });
    await expect(applyMoneyMove(f.db, f.move)).rejects.toThrow("Interrupted");
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    for (let i = 0; i < 8; i++) expect(f.balance(`payer:${i}`)).toBe(90);
    expect(f.balance("recipient")).toBe(80);
  });

  it("serializes concurrent independent purchases through protected target generations", async () => {
    const f = fixture(8);
    const second = { ...f.move, key: "funded-producers:2" };
    await Promise.all([applyMoneyMove(f.db, f.move), applyMoneyMove(f.db, second)]);
    expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
    expect((await resumeMoneyMove(f.db, second.key)).status).toBe("applied");
    for (let i = 0; i < 8; i++) expect(f.balance(`payer:${i}`)).toBe(80);
    expect(f.balance("recipient")).toBe(160);
  });

  it.each([
    { onCall: 1, afterWrite: false },
    { onCall: 1, afterWrite: true },
    { onCall: 2, afterWrite: false },
    { onCall: 2, afterWrite: true },
  ])(
    "recovers delivery and acknowledgement-release crashes: %j",
    async ({ onCall, afterWrite }) => {
      const f = fixture(8);
      const faulty = withInjectedCrash(f.memory, {
        collection: "accounts",
        op: "bulkWrite",
        onCall,
        afterWrite,
      });
      await expect(applyMoneyMove(faulty.db, f.move)).rejects.toThrow();
      faulty.disarm();
      expect((await resumeMoneyMove(f.db, f.move.key)).status).toBe("applied");
      for (let i = 0; i < 8; i++) expect(f.balance(`payer:${i}`)).toBe(90);
      expect(f.balance("recipient")).toBe(80);
      await resumeMoneyMove(f.db, f.move.key);
      expect(f.balance("recipient")).toBe(80);
    }
  );
});
