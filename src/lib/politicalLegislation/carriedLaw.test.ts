import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { carriedLawIdFor } from "./carriedLaw";

describe("carriedLawIdFor", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("legislationTypes").findOne.mockResolvedValue(null);
  });

  it("finds a law re-scoped to this country by a merge", async () => {
    db.collection("legislationTypes").findOne.mockResolvedValue({
      _id: "dd.sec.reservesVoluntaryDefense",
    });

    const found = await carriedLawIdFor(db as unknown as Db, "DE", [
      "us.sec.reserveForces",
      "dd.sec.reservesVoluntaryDefense",
    ]);

    expect(found).toBe("dd.sec.reservesVoluntaryDefense");
    const filter = db.collectionMocks["legislationTypes"].findOne.mock.calls[0][0];
    expect(filter.countryScope).toBe("de"); // countryScope is lower-case
    expect(filter._id.$in).toContain("dd.sec.reservesVoluntaryDefense");
  });

  it("returns null for a country that absorbed nobody", async () => {
    const found = await carriedLawIdFor(db as unknown as Db, "JP", ["us.sec.reserveForces"]);
    expect(found).toBeNull();
  });

  it("fails open on a missing country instead of throwing", async () => {
    // A corporation whose `countryId` was never stamped reaches the merger gate
    // this way; a gate whose contract is to be skippable must not throw.
    await expect(
      carriedLawIdFor(db as unknown as Db, undefined, ["us.economy.competition.primary"])
    ).resolves.toBeNull();
    expect(db.collection("legislationTypes").findOne).not.toHaveBeenCalled();
  });

  it("does not query when there are no known law ids", async () => {
    await expect(carriedLawIdFor(db as unknown as Db, "DE", [])).resolves.toBeNull();
    expect(db.collection("legislationTypes").findOne).not.toHaveBeenCalled();
  });
});
