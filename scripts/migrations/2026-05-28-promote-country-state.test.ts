/**
 * Tests for the country-state promotion migration.
 *
 * Verifies:
 *   1. Creates one countryState doc per COUNTRY_CONFIGS entry on a fresh DB.
 *   2. Copies governmentType correctly for known countries (CN spot-check).
 *   3. Idempotent — skips countries that already have a doc.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

vi.mock("../utils/db", () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

import { applyPromoteCountryState } from "./2026-05-28-promote-country-state";

function makeCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("applyPromoteCountryState", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collectionMocks.countryState.find.mockReturnValue(makeCursor([]));
  });

  it("creates one countryState document per COUNTRY_CONFIGS entry", async () => {
    const result = await applyPromoteCountryState(db as unknown as Db);

    const countryIds = Object.keys(COUNTRY_CONFIGS);
    expect(result.created).toBe(countryIds.length);
    expect(result.skipped).toBe(0);
    expect(db.collectionMocks.countryState.insertOne).toHaveBeenCalledTimes(countryIds.length);
  });

  it("seeds new docs with Phase-5 reform fields initialized", async () => {
    await applyPromoteCountryState(db as unknown as Db);

    const insertCalls = db.collectionMocks.countryState.insertOne.mock.calls;
    const cnInsert = insertCalls.find((call: unknown[]) => {
      const doc = call[0] as { _id: string };
      return doc._id === "CN";
    });
    const doc = cnInsert![0] as {
      reformCooldowns: Record<string, unknown>;
      popularBoostModifiers: unknown[];
    };
    expect(doc.reformCooldowns).toEqual({});
    expect(doc.popularBoostModifiers).toEqual([]);
  });

  it("backfills Phase-5 reform fields onto pre-existing docs that lack them", async () => {
    db.collectionMocks.countryState.find.mockReturnValue(
      makeCursor([{ _id: "CN", countryId: "CN", governmentType: "onePartyState" }])
    );
    db.collectionMocks.countryState.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const result = await applyPromoteCountryState(db as unknown as Db);

    // The pre-existing CN doc was skipped on insert, then backfilled by updateMany.
    expect(result.backfilled).toBe(1);
    const updateCalls = db.collectionMocks.countryState.updateMany.mock.calls;
    expect(updateCalls).toHaveLength(1);
    const filter = updateCalls[0][0] as { reformCooldowns: { $exists: boolean } };
    expect(filter).toEqual({ reformCooldowns: { $exists: false } });
    const set = (
      updateCalls[0][1] as {
        $set: { reformCooldowns: unknown; popularBoostModifiers: unknown[] };
      }
    ).$set;
    expect(set.reformCooldowns).toEqual({});
    expect(set.popularBoostModifiers).toEqual([]);
  });

  it("copies governmentType from COUNTRY_CONFIGS.CN", async () => {
    await applyPromoteCountryState(db as unknown as Db);

    const insertCalls = db.collectionMocks.countryState.insertOne.mock.calls;
    const cnInsert = insertCalls.find((call: unknown[]) => {
      const doc = call[0] as { _id: string };
      return doc._id === "CN";
    });
    expect(cnInsert).toBeDefined();
    const doc = cnInsert![0] as { governmentType: string };
    expect(doc.governmentType).toBe("onePartyState");
  });

  it("is idempotent — skips countries that already have state", async () => {
    db.collectionMocks.countryState.find.mockReturnValue(
      makeCursor([{ _id: "CN", countryId: "CN", governmentType: "onePartyState" }])
    );

    const result = await applyPromoteCountryState(db as unknown as Db);

    expect(result.skipped).toBe(1);
    const insertCalls = db.collectionMocks.countryState.insertOne.mock.calls;
    const cnInsert = insertCalls.find((call: unknown[]) => {
      const doc = call[0] as { _id: string };
      return doc._id === "CN";
    });
    expect(cnInsert).toBeUndefined();
  });
});
