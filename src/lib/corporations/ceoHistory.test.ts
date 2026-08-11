import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { openCeoTenure, closeCeoTenure, wasCeoWithinTurns } from "./ceoHistory";
import type { Corporation } from "@/lib/db/types";

let db: MockDb;
const corpId = new ObjectId();
const holderA = new ObjectId();
const holderB = new ObjectId();

beforeEach(() => {
  db = createMockDb();
  db.collection("corporations");
});

describe("wasCeoWithinTurns (pure)", () => {
  it("true when an entry's endTurn is within the window", () => {
    const corp = {
      ceoHistory: [{ holderId: holderA, ceoType: "character", startTurn: 1, endTurn: 50 }],
    } as unknown as Corporation;
    expect(wasCeoWithinTurns(corp, holderA, 100, 120)).toBe(true);
  });
  it("false when endTurn is older than the window", () => {
    const corp = {
      ceoHistory: [{ holderId: holderA, ceoType: "character", startTurn: 1, endTurn: 50 }],
    } as unknown as Corporation;
    expect(wasCeoWithinTurns(corp, holderA, 200, 120)).toBe(false);
  });
  it("true for an open tenure (endTurn absent)", () => {
    const corp = {
      ceoHistory: [{ holderId: holderA, ceoType: "character", startTurn: 1 }],
    } as unknown as Corporation;
    expect(wasCeoWithinTurns(corp, holderA, 999, 120)).toBe(true);
  });
  it("false for a different holder", () => {
    const corp = {
      ceoHistory: [{ holderId: holderA, ceoType: "character", startTurn: 1, endTurn: 50 }],
    } as unknown as Corporation;
    expect(wasCeoWithinTurns(corp, holderB, 60, 120)).toBe(false);
  });
});

describe("openCeoTenure / closeCeoTenure", () => {
  it("opens a new tenure and closes the previous open one", async () => {
    const calls: unknown[] = [];
    db.collectionMocks["corporations"]!.updateOne = (async (...args: unknown[]) => {
      calls.push(args);
      return { matchedCount: 1 };
    }) as never;

    await openCeoTenure(db as never, corpId, {
      holderId: holderA,
      ceoType: "character",
      turn: 10,
    });
    // First call closes any open tenure (arrayFilters), second pushes new.
    expect(calls.length).toBe(2);
  });

  it("closeCeoTenure stamps endTurn on the holder's open tenure", async () => {
    let update: Record<string, unknown> | undefined;
    db.collectionMocks["corporations"]!.updateOne = (async (
      _f: unknown,
      u: Record<string, unknown>
    ) => {
      update = u;
      return { matchedCount: 1 };
    }) as never;

    await closeCeoTenure(db as never, corpId, { holderId: holderA, turn: 77 });
    expect(JSON.stringify(update)).toContain("ceoHistory.$[t].endTurn");
  });

  // Regression (prod ISE): a positional array update (`ceoHistory.$[t]`) throws
  // MongoServerError "The path 'ceoHistory' must exist in the document in order
  // to apply array updates" when the field is absent — true for brand-new corps
  // (founding doesn't seed it) and legacy corps founded before this feature.
  // The close-step must filter on `ceoHistory: { $exists: true }` so a missing
  // field is a no-op instead of a 500. The $push that follows creates the array.
  it("openCeoTenure guards the close-step so a missing ceoHistory field is a no-op", async () => {
    const filters: Record<string, unknown>[] = [];
    db.collectionMocks["corporations"]!.updateOne = (async (f: Record<string, unknown>) => {
      filters.push(f);
      return { matchedCount: 1 };
    }) as never;

    await openCeoTenure(db as never, corpId, {
      holderId: holderA,
      ceoType: "character",
      turn: 10,
    });

    // First call is the close-step (arrayFilters $set) — it must be gated on the
    // field existing so it never errors on a doc that lacks `ceoHistory`.
    expect(filters[0]).toMatchObject({ ceoHistory: { $exists: true } });
  });

  it("closeCeoTenure guards against a missing ceoHistory field", async () => {
    let filter: Record<string, unknown> | undefined;
    db.collectionMocks["corporations"]!.updateOne = (async (f: Record<string, unknown>) => {
      filter = f;
      return { matchedCount: 1 };
    }) as never;

    await closeCeoTenure(db as never, corpId, { holderId: holderA, turn: 77 });
    expect(filter).toMatchObject({ ceoHistory: { $exists: true } });
  });
});
