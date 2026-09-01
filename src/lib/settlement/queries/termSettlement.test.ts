import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { loadTermSettlement } from "./termSettlement";

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

describe("loadTermSettlement", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    prime(db, "settlementCrises").findOne.mockResolvedValue({
      _id: new ObjectId(),
      status: "frozen",
      conflictId: "war_us_dd_415",
      challengerEntityId: "DD",
      targetEntityId: "DE",
    });
  });

  it("names the challenger of the question riding that war", async () => {
    expect(await loadTermSettlement(db as unknown as Db, "war_us_dd_415")).toEqual({
      challenger: "DD",
    });
  });

  it("asks only for a FROZEN crisis on that exact war", async () => {
    // Both roads that offer the term are mid-war, so a resolved or open crisis is not
    // one this term can settle. createMockDb ignores filters: the filter is the assertion.
    await loadTermSettlement(db as unknown as Db, "war_us_dd_415");
    const [filter] = prime(db, "settlementCrises").findOne.mock.calls[0];
    expect(filter).toMatchObject({ conflictId: "war_us_dd_415", status: "frozen" });
  });

  it("returns null when no question is riding that war", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    expect(await loadTermSettlement(db as unknown as Db, "war_us_dd_415")).toBe(null);
  });
});
