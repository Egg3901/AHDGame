/**
 * Tests for the cpcPurgeEvents -> rulingPartyPurgeEvents collection rename.
 *
 * Idempotent: skips when the target already has documents.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("../utils/db", () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

import { renameCpcPurgeEventsCollection } from "./2026-05-27-rename-cpc-purge-events-collection";

function makeCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("renameCpcPurgeEventsCollection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("cpcPurgeEvents");
    db.collection("rulingPartyPurgeEvents");
  });

  it("copies docs from cpcPurgeEvents to rulingPartyPurgeEvents and drops the old", async () => {
    const docA = { _id: new ObjectId().toString(), countryId: "CN", severity: "minor" };
    const docB = { _id: new ObjectId().toString(), countryId: "CN", severity: "regional" };
    db.collectionMocks.cpcPurgeEvents.find.mockReturnValue(makeCursor([docA, docB]));
    db.collectionMocks.rulingPartyPurgeEvents.countDocuments.mockResolvedValue(0);

    const dbWithDrop = db as unknown as Db & {
      dropCollection: ReturnType<typeof vi.fn>;
    };
    dbWithDrop.dropCollection = vi.fn().mockResolvedValue(true);

    const result = await renameCpcPurgeEventsCollection(dbWithDrop);

    expect(result.copied).toBe(2);
    expect(result.skipped).toBe(false);
    expect(db.collectionMocks.rulingPartyPurgeEvents.insertMany).toHaveBeenCalledWith([docA, docB]);
    expect(dbWithDrop.dropCollection).toHaveBeenCalledWith("cpcPurgeEvents");
  });

  it("is idempotent when rulingPartyPurgeEvents is already populated", async () => {
    db.collectionMocks.rulingPartyPurgeEvents.countDocuments.mockResolvedValue(5);

    const dbWithDrop = db as unknown as Db & {
      dropCollection: ReturnType<typeof vi.fn>;
    };
    dbWithDrop.dropCollection = vi.fn().mockResolvedValue(true);

    const result = await renameCpcPurgeEventsCollection(dbWithDrop);

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(true);
    expect(db.collectionMocks.rulingPartyPurgeEvents.insertMany).not.toHaveBeenCalled();
    expect(dbWithDrop.dropCollection).not.toHaveBeenCalled();
  });

  it("still drops the old collection when there were zero docs to copy", async () => {
    db.collectionMocks.cpcPurgeEvents.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.rulingPartyPurgeEvents.countDocuments.mockResolvedValue(0);

    const dbWithDrop = db as unknown as Db & {
      dropCollection: ReturnType<typeof vi.fn>;
    };
    dbWithDrop.dropCollection = vi.fn().mockResolvedValue(true);

    const result = await renameCpcPurgeEventsCollection(dbWithDrop);

    expect(result.copied).toBe(0);
    expect(result.skipped).toBe(false);
    expect(db.collectionMocks.rulingPartyPurgeEvents.insertMany).not.toHaveBeenCalled();
    expect(dbWithDrop.dropCollection).toHaveBeenCalledWith("cpcPurgeEvents");
  });
});
