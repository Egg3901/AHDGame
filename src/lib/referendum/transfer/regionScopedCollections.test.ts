import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { rescopeRegionToCountry, REGION_SCOPED_COLLECTIONS } from "./regionScopedCollections";

describe("rescopeRegionToCountry", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("flips countryId on a stateId-keyed collection for the region only", async () => {
    await rescopeRegionToCountry(db as unknown as Db, "NIR", "UK", "IE", [
      { collection: "statePartyOrg", key: "stateIdField" },
    ]);
    const call = db.collectionMocks["statePartyOrg"].updateMany.mock.calls[0];
    expect(call[0]).toEqual({ stateId: "NIR" });
    expect(call[1].$set.countryId).toBe("IE");
  });

  it("flips countryId on an _id-is-region collection by _id", async () => {
    await rescopeRegionToCountry(db as unknown as Db, "NIR", "UK", "IE", [
      { collection: "macroMetrics", key: "idIsState" },
    ]);
    const call = db.collectionMocks["macroMetrics"].updateMany.mock.calls[0];
    expect(call[0]).toEqual({ _id: "NIR" });
    expect(call[1].$set.countryId).toBe("IE");
  });

  it("flips countryId on a `state`-field collection (officials/seats)", async () => {
    await rescopeRegionToCountry(db as unknown as Db, "NIR", "UK", "IE", [
      { collection: "seats", key: "stateField" },
    ]);
    const call = db.collectionMocks["seats"].updateMany.mock.calls[0];
    expect(call[0]).toEqual({ state: "NIR" });
    expect(call[1].$set.countryId).toBe("IE");
  });

  it("flips countryId on characters by homeState, leaving homeState unchanged", async () => {
    await rescopeRegionToCountry(db as unknown as Db, "NIR", "UK", "IE", [
      { collection: "characters", key: "homeStateField" },
    ]);
    const call = db.collectionMocks["characters"].updateMany.mock.calls[0];
    expect(call[0]).toEqual({ homeState: "NIR" });
    expect(call[1].$set.countryId).toBe("IE");
    expect(call[1].$set.homeState).toBeUndefined(); // residency unchanged
  });

  it("re-keys a composite-`_id` collection from the old owner to the new", async () => {
    db.collection("stateRegistrationPool").findOne.mockResolvedValue({
      _id: "UK_NIR",
      stateId: "NIR",
      countryId: "UK",
      independent: 500,
    });
    await rescopeRegionToCountry(db as unknown as Db, "NIR", "UK", "IE", [
      { collection: "stateRegistrationPool", key: "compositeCountryState" },
    ]);
    const mocks = db.collectionMocks["stateRegistrationPool"];
    expect(mocks.deleteOne).toHaveBeenCalledWith({ _id: "UK_NIR" });
    const inserted = mocks.insertOne.mock.calls[0][0];
    expect(inserted._id).toBe("IE_NIR");
    expect(inserted.countryId).toBe("IE");
    expect(inserted.independent).toBe(500); // payload preserved
  });

  it("returns a matched-count report per collection", async () => {
    db.collection("statePartyOrg").updateMany.mockResolvedValue({
      matchedCount: 3,
      modifiedCount: 3,
    });
    const report = await rescopeRegionToCountry(db as unknown as Db, "NIR", "UK", "IE", [
      { collection: "statePartyOrg", key: "stateIdField" },
    ]);
    expect(report).toEqual([{ collection: "statePartyOrg", matched: 3 }]);
  });

  it("default list covers persistent region state but excludes dedicated-handling collections", () => {
    const names = REGION_SCOPED_COLLECTIONS.map((s) => s.collection);
    // Persistent region state is re-scoped…
    expect(names).toContain("macroMetrics");
    // The political board is re-scoped too: it carries `countryId`, and the
    // dynamics phase drives regions by that field, so a transferred region
    // whose board still named its old country would be driven by the wrong law
    // catalog and scored against the wrong approval intercept.
    expect(names).toContain("politicalMetrics");
    expect(names).toContain("characters");
    expect(names).toContain("stateRegistrationPool");
    // Sectors operate IN the region, so they follow it across the border…
    expect(names).toContain("corporateSectors");
    expect(names).toContain("unownedSectors");
    // The per-state fiscal budget, demographics, and registration pool follow too:
    expect(names).toContain("stateBudgets");
    expect(names).toContain("stateDemographics");
    expect(names).toContain("demographicDefaults");
    expect(names).toContain("stateRegistrationPool");
    // …but strategic-sector designations are country-level, not region-scoped:
    expect(names).not.toContain("strategicSectors");
    // …but collections with dedicated steps are NOT in the generic list:
    //  - region/officials/seats/parties have their own migration steps;
    //  - the region's party orgs are DELETED by evacuateRegionPolitics, not re-scoped.
    expect(names).not.toContain("states");
    expect(names).not.toContain("electedOfficials");
    expect(names).not.toContain("seats");
    expect(names).not.toContain("politicalParties");
    expect(names).not.toContain("statePartyOrg");
    expect(names).not.toContain("partyBudget");
    expect(names).not.toContain("billWhips");
  });
});
