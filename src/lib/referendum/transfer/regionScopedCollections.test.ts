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
    const [filter, moved] = mocks.replaceOne.mock.calls[0];
    expect(filter).toEqual({ _id: "IE_NIR" });
    expect(moved.countryId).toBe("IE");
    expect(moved.independent).toBe(500); // payload preserved
  });

  it("writes the new key BEFORE dropping the old one", async () => {
    // Order is the difference between a failure that can be re-run and one that has
    // already destroyed the row it was moving. Delete-first is what turned a
    // duplicate-key error into permanent data loss on the live merge.
    db.collection("stateRegistrationPool").findOne.mockResolvedValue({
      _id: "UK_NIR",
      countryId: "UK",
      independent: 500,
    });
    const order: string[] = [];
    db.collection("stateRegistrationPool").replaceOne.mockImplementation(async () => {
      order.push("write");
      return { acknowledged: true };
    });
    db.collection("stateRegistrationPool").deleteOne.mockImplementation(async () => {
      order.push("delete");
      return { deletedCount: 1 };
    });
    await rescopeRegionToCountry(db as unknown as Db, "NIR", "UK", "IE", [
      { collection: "stateRegistrationPool", key: "compositeCountryState" },
    ]);
    expect(order).toEqual(["write", "delete"]);
  });

  it("survives the destination already holding a row for that region", async () => {
    // A COUNTRY MERGE moves a region into a country that was seeded with its own
    // row for the same Land, so the destination key is already taken. Insert-only
    // re-keying throws E11000 with the source row ALREADY DELETED, which is how the
    // live German reunification died part-way through its second Land, taking that
    // Land's registration pool with it.
    db.collection("stateRegistrationPool").findOne.mockResolvedValue({
      _id: "DD_MV",
      stateId: "MV",
      countryId: "DD",
      independent: 500,
    });
    db.collection("stateRegistrationPool").insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
    );
    await expect(
      rescopeRegionToCountry(db as unknown as Db, "MV", "DD", "DE", [
        { collection: "stateRegistrationPool", key: "compositeCountryState" },
      ])
    ).resolves.toBeDefined();
  });

  it("lets the MOVING region's own row win over the destination's seeded one", async () => {
    // The region is the thing that moves, so its live row goes with it. The
    // destination's row is for a Land it never actually held. (A region FUSE is the
    // other way round and keeps the target's row, which `mergeRegion` argues at its
    // own call site: there both regions stay in one country.)
    db.collection("stateRegistrationPool").findOne.mockResolvedValue({
      _id: "DD_MV",
      stateId: "MV",
      countryId: "DD",
      independent: 500,
    });
    await rescopeRegionToCountry(db as unknown as Db, "MV", "DD", "DE", [
      { collection: "stateRegistrationPool", key: "compositeCountryState" },
    ]);
    const mocks = db.collectionMocks["stateRegistrationPool"];
    expect(mocks.deleteOne).toHaveBeenCalledWith({ _id: "DD_MV" });
    const [filter, doc, options] = mocks.replaceOne.mock.calls[0];
    expect(filter).toEqual({ _id: "DE_MV" });
    expect(doc.countryId).toBe("DE");
    expect(doc.independent).toBe(500);
    expect(options).toEqual({ upsert: true });
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

  it("covers the records a dissolving merge would otherwise strand", () => {
    const names = REGION_SCOPED_COLLECTIONS.map((s) => s.collection);
    // A referendum transfer could leave these behind harmlessly, because the
    // source country survived to keep owning them. A country merge cannot: the
    // country they point at stops existing.
    for (const c of [
      "enactedLaws",
      "electionVoteTallies",
      "elections",
      "statePartyCandidates",
      "recruitmentSlates",
      "slateCandidates",
      "prospectingSurveys",
    ]) {
      expect(names).toContain(c);
    }
  });

  it("keys each stranded collection by the field it actually carries", () => {
    const by = (c: string) => REGION_SCOPED_COLLECTIONS.find((s) => s.collection === c)?.key;
    expect(by("enactedLaws")).toBe("stateIdField");
    expect(by("electionVoteTallies")).toBe("stateField");
    expect(by("elections")).toBe("stateField");
    expect(by("statePartyCandidates")).toBe("stateIdField");
    expect(by("recruitmentSlates")).toBe("stateField");
    // Slate candidates are keyed by residency, not by the slate's region.
    expect(by("slateCandidates")).toBe("homeStateField");
    expect(by("prospectingSurveys")).toBe("stateIdField");
  });
});
