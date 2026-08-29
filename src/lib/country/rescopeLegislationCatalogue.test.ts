import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { rescopeLegislationCatalogue } from "./rescopeLegislationCatalogue";

describe("rescopeLegislationCatalogue", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("legislationTypes").updateMany.mockResolvedValue({ modifiedCount: 115 });
  });

  it("re-scopes the absorbed country's types to the survivor, lower-cased", async () => {
    const res = await rescopeLegislationCatalogue(db as unknown as Db, "DD", "DE");
    const call = db.collectionMocks["legislationTypes"].updateMany.mock.calls[0];
    expect(call[0]).toEqual({ countryScope: "dd" });
    expect(call[1].$set.countryScope).toBe("de");
    expect(res.typesRescoped).toBe(115);
  });

  it("leaves the enacted laws' type ids untouched", async () => {
    await rescopeLegislationCatalogue(db as unknown as Db, "DD", "DE");
    // The laws keep resolving because `legislationTypes` is global and its docs
    // survive the dissolution; rewriting a law's identity would falsify history.
    // Asserted on collection ACCESS, since a collection never touched has no mock.
    const touched = db.collection.mock.calls.map((c) => c[0]);
    expect(touched).not.toContain("enactedLaws");
    expect(touched).toContain("legislationTypes");
  });

  it("is a no-op when the two countries are the same", async () => {
    const res = await rescopeLegislationCatalogue(db as unknown as Db, "DE", "DE");
    expect(res.typesRescoped).toBe(0);
    expect(db.collectionMocks["legislationTypes"].updateMany).not.toHaveBeenCalled();
  });
});
