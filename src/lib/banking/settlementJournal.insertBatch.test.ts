import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { applyProjection, resumeSettlement, settleTransition } from "./settlementJournal";
import type { BankingTransition } from "./rules/boundary";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: `row-${i}`, n: i }));

function transition(key: string, inserts: Record<string, unknown>[]): BankingTransition {
  return {
    key,
    kind: "batch_insert_test",
    turn: 1,
    currency: "USD",
    legs: [],
    projections: [{ collection: "receipts", inserts, note: "Batched receipts" }],
    event: { kind: "bank.resolved", command: "test" },
  };
}

describe("batched insert projections", () => {
  it("writes every document once and replays without duplicating", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const first = await settleTransition(db, transition("k1", rows(5)));
    expect(first.status).toBe("applied");
    expect(memory.collection("receipts").docs).toHaveLength(5);
    const again = await settleTransition(db, transition("k1", rows(5)));
    expect(["applied", "replayed"]).toContain(again.status);
    expect(memory.collection("receipts").docs).toHaveLength(5);
  });

  it("lands only the missing documents when an earlier attempt wrote some", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("receipts", rows(2));
    const outcome = await applyProjection(db, {
      collection: "receipts",
      inserts: rows(5),
      note: "Batched receipts",
    });
    expect(outcome).toEqual({ ok: true });
    expect(memory.collection("receipts").docs.map((d) => d._id)).toEqual([
      "row-0",
      "row-1",
      "row-2",
      "row-3",
      "row-4",
    ]);
  });

  it("finishes a crashed batch from the journal record", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const target = memory.collection("receipts");
    const write = target.insertMany.bind(target);
    let crashed = false;
    target.insertMany = async (docs: Record<string, unknown>[]) => {
      if (!crashed) {
        crashed = true;
        await write(docs.slice(0, 3));
        throw new Error("crash mid batch");
      }
      return write(docs);
    };
    await settleTransition(db, transition("k2", rows(6))).catch(() => undefined);
    await resumeSettlement(db, "k2");
    expect(memory.collection("receipts").docs).toHaveLength(6);
  });

  it("rejects a document without a fixed id", async () => {
    const memory = createInMemoryDb();
    const outcome = await applyProjection(memory as unknown as Db, {
      collection: "receipts",
      inserts: [{ n: 1 }],
      note: "Batched receipts",
    });
    expect(outcome.ok).toBe(false);
    expect(memory.collection("receipts").docs).toHaveLength(0);
  });
});
