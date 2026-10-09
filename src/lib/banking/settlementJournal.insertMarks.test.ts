import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resumeSettlement, settleTransition } from "./settlementJournal";
import type { BankingTransition } from "./rules/boundary";

/** Several single-document insert projections, the shape of a fund payout's receipts. */
function transition(key: string, count: number): BankingTransition {
  return {
    key,
    kind: "insert_marks_test",
    turn: 1,
    currency: "USD",
    legs: [],
    projections: Array.from({ length: count }, (_, i) => ({
      collection: `receipts${i}`,
      insert: { _id: `${key}:${i}`, n: i },
      note: `receipt ${i}`,
    })),
    event: { kind: "bank.resolved", command: "test" },
  };
}

function journalWrites(memory: ReturnType<typeof createInMemoryDb>) {
  const journal = memory.collection("bankMoneyMoves");
  const original = journal.updateOne.bind(journal);
  const writes: Record<string, unknown>[] = [];
  journal.updateOne = (async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => {
    writes.push(update);
    return original(filter, update, options);
  }) as typeof journal.updateOne;
  return writes;
}

describe("insert projection marks", () => {
  it("records every insert as applied with the completion write, not one write each", async () => {
    const memory = createInMemoryDb();
    const writes = journalWrites(memory);
    const result = await settleTransition(memory as unknown as Db, transition("k1", 5));
    expect(result.status).toBe("applied");
    const marking = writes.filter((w) =>
      Object.keys((w.$set as Record<string, unknown>) ?? {}).some((k) => k.endsWith(".appliedAt"))
    );
    expect(marking).toHaveLength(1);
    const record = memory.collection("bankMoneyMoves").docs[0] as {
      status: string;
      projections: { applied: boolean; appliedAt: Date | null }[];
    };
    expect(record.status).toBe("applied");
    expect(record.projections.every((p) => p.applied && p.appliedAt instanceof Date)).toBe(true);
  });

  it("keeps the marks of inserts that landed before a failure and finishes on resume", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const third = memory.collection("receipts2");
    const insert = third.insertOne.bind(third);
    let crashed = false;
    third.insertOne = (async (doc: Record<string, unknown>) => {
      if (!crashed) {
        crashed = true;
        await insert(doc);
        throw new Error("crash after the third insert landed");
      }
      return insert(doc);
    }) as typeof third.insertOne;
    // The projection layer turns the failed insert into a partial settlement.
    // The inserts before it landed; their marks ride on that partial write.
    const first = await settleTransition(db, transition("k2", 4));
    expect(first.status).toBe("partial");
    expect(memory.collection("receipts0").docs).toHaveLength(1);
    const partial = memory.collection("bankMoneyMoves").docs[0] as {
      projections: { applied: boolean }[];
    };
    expect(partial.projections.map((p) => p.applied)).toEqual([true, true, false, false]);
    const resumed = await resumeSettlement(db, "k2");
    expect(resumed.status).toBe("applied");
    for (let i = 0; i < 4; i++) expect(memory.collection(`receipts${i}`).docs).toHaveLength(1);
    const record = memory.collection("bankMoneyMoves").docs[0] as {
      projections: { applied: boolean }[];
    };
    expect(record.projections.every((p) => p.applied)).toBe(true);
  });
});
