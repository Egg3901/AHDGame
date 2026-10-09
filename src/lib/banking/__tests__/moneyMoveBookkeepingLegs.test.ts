import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { applyMoneyMove, resumeMoneyMove, type MoneyMove } from "../moneyMove";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/** A realized receipt: money enters the world and lands on one account. */
function fixture() {
  const memory = createInMemoryDb();
  memory.seed("accounts", [{ _id: "corp", balance: 0 }]);
  const move: MoneyMove = {
    key: "gross:1",
    kind: "corporate_operating_gross_receipt",
    turn: 3,
    legs: [
      { kind: "mint", amount: 50, note: "realized receipts" },
      {
        kind: "credit",
        amount: 50,
        collection: "accounts",
        filter: { _id: "corp" },
        path: "balance",
        note: "credit receipts",
      },
    ],
  };
  const journal = memory.collection("bankMoneyMoves");
  const record = () =>
    journal.docs[0] as { status: string; legs: { kind: string; applied: boolean }[] };
  const balance = () => memory.collection("accounts").docs[0].balance as number;
  return { memory, db: memory as unknown as Db, move, journal, record, balance };
}

describe("mint and burn legs", () => {
  it("are recorded applied by the completion write, not a write of their own", async () => {
    const f = fixture();
    const updates: Record<string, unknown>[] = [];
    const original = f.journal.updateOne.bind(f.journal);
    f.journal.updateOne = (async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => {
      updates.push(update);
      return original(filter, update, options);
    }) as typeof f.journal.updateOne;
    const result = await applyMoneyMove(f.db, f.move);
    expect(result.status).toBe("applied");
    expect(result.applied).toEqual([0, 1]);
    expect(f.record().status).toBe("applied");
    expect(f.record().legs.every((leg) => leg.applied)).toBe(true);
    expect(f.balance()).toBe(50);
    const mintOnly = updates.filter((u) => {
      const set = (u.$set ?? {}) as Record<string, unknown>;
      return Object.keys(set).length === 1 && "legs.0.applied" in set;
    });
    expect(mintOnly).toHaveLength(0);
  });

  it("are marked on resume after a crash before completion", async () => {
    const f = fixture();
    const faulty = withInjectedCrash(f.memory, {
      collection: "bankMoneyMoves",
      op: "updateOne",
      onCall: 1,
      matches: (args) => {
        const set = ((args[1] as Record<string, unknown>)?.$set ?? {}) as Record<string, unknown>;
        return "completedAt" in set;
      },
    });
    await expect(applyMoneyMove(faulty.db, f.move)).rejects.toBeInstanceOf(InjectedCrash);
    expect(f.record().legs[0].applied).toBe(false);
    expect(f.balance()).toBe(50);
    faulty.disarm();
    const resumed = await resumeMoneyMove(f.db, "gross:1");
    expect(resumed.status).toBe("applied");
    expect(f.record().legs.every((leg) => leg.applied)).toBe(true);
    expect(f.balance()).toBe(50);
  });

  it("stay unapplied when an earlier leg stops the move", async () => {
    const memory = createInMemoryDb();
    memory.seed("accounts", [{ _id: "payer", balance: 10 }]);
    const result = await applyMoneyMove(memory as unknown as Db, {
      key: "burn:1",
      kind: "write_off",
      legs: [
        {
          kind: "debit",
          amount: 40,
          collection: "accounts",
          filter: { _id: "payer" },
          path: "balance",
          note: "take more than is there",
        },
        { kind: "burn", amount: 40, note: "write off" },
      ],
    });
    expect(result.status).toBe("rejected");
    const record = memory.collection("bankMoneyMoves").docs[0] as { legs: { applied: boolean }[] };
    expect(record.legs.map((leg) => leg.applied)).toEqual([false, false]);
    expect(memory.collection("accounts").docs[0].balance).toBe(10);
  });
});
