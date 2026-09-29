import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { emitTreasuryTransaction, emitTreasuryTransactionsBulk } from "./emit";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

interface InsertedDoc extends Record<string, unknown> {
  _id?: ObjectId;
}

function makeDb(opts: { currentTurn?: number; budgetCurrencies?: Record<string, string> } = {}): {
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
      if (name === "federalBudget") {
        return {
          find: () => ({
            toArray: async () =>
              Object.entries(opts.budgetCurrencies ?? {}).map(([_id, currencyCode]) => ({
                _id,
                currencyCode,
              })),
          }),
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

  it("stamps the era-blind map code when no explicit currency is passed", async () => {
    const { db, inserts } = makeDb();
    await emitTreasuryTransaction({
      db,
      countryId: "FR",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "transfers",
      direction: "debit",
      amount: 100,
      memo: "legacy path",
      turn: 1,
    });
    expect(inserts[0].currencyCode).toBe("FRF");
  });

  it("prefers an explicit currency over the era-blind map", async () => {
    const { db, inserts } = makeDb();
    await emitTreasuryTransaction({
      db,
      countryId: "FR",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "transfers",
      direction: "debit",
      amount: 100,
      memo: "2027 euro path",
      turn: 1,
      currencyCode: "EUR",
    });
    expect(inserts[0].currencyCode).toBe("EUR");
  });

  it("stamps the persisted 2027 budget currency on a single party transaction", async () => {
    const { db, inserts } = makeDb({ budgetCurrencies: { FR: "EUR" } });
    await emitTreasuryTransaction({
      db,
      countryId: "FR",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "transfers",
      direction: "credit",
      amount: 100,
      memo: "euro transfer",
      turn: 42,
    });
    expect(inserts[0].currencyCode).toBe("EUR");
  });

  it("rejects an unknown persisted code and uses the historical fallback", async () => {
    const { db, inserts } = makeDb({ budgetCurrencies: { FR: "UNKNOWN" } });
    await emitTreasuryTransaction({
      db,
      countryId: "FR",
      partyId: "1",
      holderType: "party",
      holderId: "1",
      category: "transfers",
      direction: "credit",
      amount: 100,
      memo: "legacy fallback",
      turn: 42,
    });
    expect(inserts[0].currencyCode).toBe("FRF");
  });

  it("does not throw after a transfer when the budget currency read fails", async () => {
    const inserts: InsertedDoc[] = [];
    const db = {
      collection(name: string) {
        if (name === "federalBudget") {
          return {
            find: () => ({
              toArray: async () => {
                throw new Error("temporary read failure");
              },
            }),
          };
        }
        if (name === "treasuryTransactions") {
          return { insertOne: async (doc: InsertedDoc) => inserts.push(doc) };
        }
        throw new Error(name);
      },
    } as unknown as Db;
    await expect(
      emitTreasuryTransaction({
        db,
        countryId: "FR",
        partyId: "1",
        holderType: "party",
        holderId: "1",
        category: "transfers",
        direction: "debit",
        amount: 100,
        memo: "already committed",
        turn: 42,
      })
    ).resolves.toBeDefined();
    expect(inserts[0].currencyCode).toBe("FRF");
  });

  it("uses each persisted budget currency for a mixed-country batch", async () => {
    const inserts: InsertedDoc[] = [];
    const db = {
      collection(name: string) {
        if (name === "federalBudget") {
          return {
            find: () => ({
              toArray: async () => [
                { _id: "FR", currencyCode: "EUR" },
                { _id: "federal", currencyCode: "USD" },
              ],
            }),
          };
        }
        if (name === "treasuryTransactions") {
          return { insertMany: async (docs: InsertedDoc[]) => inserts.push(...docs) };
        }
        throw new Error(name);
      },
    } as unknown as Db;
    await emitTreasuryTransactionsBulk(
      db,
      (["FR", "US"] as const).map((countryId) => ({
        countryId,
        partyId: "1",
        holderType: "party" as const,
        holderId: "1",
        category: "transfers" as const,
        direction: "credit" as const,
        amount: 100,
        memo: "batch",
        turn: 42,
      }))
    );
    expect(inserts.map((doc) => doc.currencyCode)).toEqual(["EUR", "USD"]);
  });
});
