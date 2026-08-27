import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import {
  recordProcurementRestriction,
  activeProcurementRestriction,
} from "./procurementRestrictions";

function mockDb(existing: { expiresTurn: number } | null = null) {
  const updates: Array<{ filter: unknown; update: unknown; options: unknown }> = [];
  const db = {
    collection: () => ({
      updateOne: async (filter: unknown, update: unknown, options: unknown) => {
        updates.push({ filter, update, options });
        return { modifiedCount: 1 };
      },
      findOne: async () => existing,
    }),
  } as unknown as Db;
  return { db, updates };
}

describe("recordProcurementRestriction", () => {
  it("keys the row by country, so a second settlement extends rather than stacks", () => {
    const { db, updates } = mockDb();
    return recordProcurementRestriction(db, "TR", 340, "w1").then(() => {
      expect(updates[0]!.filter).toEqual({ _id: "TR" });
      expect(updates[0]!.options).toMatchObject({ upsert: true });
    });
  });

  it("uses $max on the expiry, so a later write cannot SHORTEN a live bar", async () => {
    // The same argument recordTruce makes: two settlements landing out of order must
    // not let the earlier expiry win. $max makes the order of the writes stop
    // mattering.
    const { db, updates } = mockDb();
    await recordProcurementRestriction(db, "TR", 340, "w1");
    const update = updates[0]!.update as { $max?: unknown; $set?: unknown };
    expect(update.$max).toEqual({ expiresTurn: 340 });
    expect(update.$set).toBeUndefined();
  });

  it("records the war it came from only on insert, so an extension keeps the original", async () => {
    const { db, updates } = mockDb();
    await recordProcurementRestriction(db, "TR", 340, "w1");
    const update = updates[0]!.update as { $setOnInsert?: Record<string, unknown> };
    expect(update.$setOnInsert).toMatchObject({ countryId: "TR", conflictId: "w1" });
  });
});

describe("activeProcurementRestriction", () => {
  it("returns null when the country has no row", async () => {
    const { db } = mockDb(null);
    expect(await activeProcurementRestriction(db, "TR", 100)).toBeNull();
  });

  it("returns the lapse turn while the bar is in force", async () => {
    const { db } = mockDb({ expiresTurn: 340 });
    expect(await activeProcurementRestriction(db, "TR", 339)).toBe(340);
  });

  it("lapses ON the expiry turn, matching the truce and offer convention", async () => {
    const { db } = mockDb({ expiresTurn: 340 });
    expect(await activeProcurementRestriction(db, "TR", 340)).toBeNull();
  });

  it("stays lapsed well past the expiry", async () => {
    const { db } = mockDb({ expiresTurn: 340 });
    expect(await activeProcurementRestriction(db, "TR", 9999)).toBeNull();
  });
});
