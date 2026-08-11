import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { emitTreasuryTransaction } from "./emit";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

interface InsertedDoc extends Record<string, unknown> {
  _id?: ObjectId;
}

function makeDb(opts: { currentTurn?: number } = {}): {
  db: Db;
  inserts: InsertedDoc[];
} {
  const inserts: InsertedDoc[] = [];
  const db = {
    collection(name: string) {
      if (name === "gameState") {
        return {
          findOne: async () =>
            opts.currentTurn != null ? { _id: "current", currentTurn: opts.currentTurn } : null,
        };
      }
      return {
        insertOne: async (doc: InsertedDoc) => {
          inserts.push(doc);
          return { insertedId: doc._id };
        },
      };
    },
  } as unknown as Db;
  return { db, inserts };
}

describe("emitTreasuryTransaction", () => {
  it("inserts a row with positive amount + caller-supplied turn", async () => {
    const { db, inserts } = makeDb();
    const now = new Date("2026-04-27T12:00:00Z");
    await emitTreasuryTransaction({
      db,
      countryId: "US",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "donations",
      direction: "credit",
      amount: 500,
      memo: "Donation from Alice",
      turn: 42,
      now,
    });

    expect(inserts).toHaveLength(1);
    const doc = inserts[0];
    expect(doc.amount).toBe(500);
    expect(doc.direction).toBe("credit");
    expect(doc.category).toBe("donations");
    expect(doc.turn).toBe(42);
    expect(doc.createdAt).toEqual(now);
    expect(doc._id).toBeInstanceOf(ObjectId);
  });

  it("preserves initiator metadata when provided", async () => {
    const { db, inserts } = makeDb();
    await emitTreasuryTransaction({
      db,
      countryId: "US",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "transfers",
      direction: "debit",
      amount: 250,
      memo: "Send to Alice",
      initiatedBy: {
        type: "character",
        id: "char-1",
        label: "Bob Smith",
      },
      turn: 7,
    });

    expect(inserts[0].initiatedBy).toEqual({
      type: "character",
      id: "char-1",
      label: "Bob Smith",
    });
  });

  it("forces amount to be positive even if a negative is passed", async () => {
    const { db, inserts } = makeDb();
    await emitTreasuryTransaction({
      db,
      countryId: "US",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "transfers",
      direction: "debit",
      amount: -1000,
      memo: "Transfer out",
      turn: 1,
    });
    expect(inserts[0].amount).toBe(1000);
  });

  it("skips zero-value emits silently", async () => {
    const { db, inserts } = makeDb();
    await emitTreasuryTransaction({
      db,
      countryId: "US",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "operations",
      direction: "debit",
      amount: 0,
      memo: "no-op",
      turn: 1,
    });
    expect(inserts).toHaveLength(0);
  });

  it("falls back to the gameState turn when caller doesn't pass one", async () => {
    const { db, inserts } = makeDb({ currentTurn: 99 });
    await emitTreasuryTransaction({
      db,
      countryId: "US",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "donations",
      direction: "credit",
      amount: 100,
      memo: "Donation",
    });
    expect(inserts[0].turn).toBe(99);
  });

  it("defaults turn to 0 when gameState is absent", async () => {
    const { db, inserts } = makeDb();
    await emitTreasuryTransaction({
      db,
      countryId: "US",
      partyId: "1",
      holderType: "caucus",
      holderId: "abc",
      category: "caucus_tax",
      direction: "credit",
      amount: 50,
      memo: "tax",
    });
    expect(inserts[0].turn).toBe(0);
  });
});
