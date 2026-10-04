/**
 * A party that merged away is read as the party that absorbed it, following
 * chains, so a stale candidacy cannot seat its winner into a dead party
 * (ticket 1376).
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadSurvivingPartyResolver } from "./survivingParty";

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

const CON = { _id: new ObjectId(), sequentialId: 2 };
const TRP = { _id: new ObjectId(), sequentialId: 8, mergedIntoPartyId: CON._id };
const TM = { _id: new ObjectId(), sequentialId: 7, mergedIntoPartyId: TRP._id };
const LD = { _id: new ObjectId(), sequentialId: 3 };
const LIB = { _id: new ObjectId(), sequentialId: 6, mergedIntoPartyId: LD._id };

function dbWith(merged: unknown[], all: unknown[]) {
  const db = createMockDb();
  db.collection("politicalParties").find.mockImplementation((filter: Record<string, unknown>) =>
    cursor("mergedIntoPartyId" in filter ? merged : all)
  );
  return db as unknown as Db;
}

describe("loadSurvivingPartyResolver", () => {
  it("maps a merged party to the party that absorbed it, following chains", async () => {
    const resolve = await loadSurvivingPartyResolver(
      dbWith([TRP, TM, LIB], [CON, TRP, TM, LD, LIB]),
      "UK"
    );
    expect(resolve("6")).toBe("3");
    expect(resolve("8")).toBe("2");
    expect(resolve("7")).toBe("2");
  });

  it("passes live parties, independents and missing values through", async () => {
    const resolve = await loadSurvivingPartyResolver(dbWith([LIB], [LD, LIB]), "UK");
    expect(resolve("3")).toBe("3");
    expect(resolve("1")).toBe("1");
    expect(resolve("independent")).toBe("independent");
    expect(resolve(undefined)).toBeUndefined();
    expect(resolve(null)).toBeNull();
  });

  it("is the identity when the country has no merged parties", async () => {
    const db = dbWith([], []);
    const resolve = await loadSurvivingPartyResolver(db, "US");
    expect(resolve("4")).toBe("4");
    expect(db.collection("politicalParties").find).toHaveBeenCalledTimes(1);
  });

  it("stops on a corrupt merge cycle instead of looping", async () => {
    const a = { _id: new ObjectId(), sequentialId: 1 } as Record<string, unknown>;
    const b = { _id: new ObjectId(), sequentialId: 2, mergedIntoPartyId: a._id };
    a.mergedIntoPartyId = b._id;
    const resolve = await loadSurvivingPartyResolver(dbWith([a, b], [a, b]), "XX");
    expect(["1", "2"]).toContain(resolve("1"));
  });
});
