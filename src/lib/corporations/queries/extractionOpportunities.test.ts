import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// Deterministic strategy: rare_earth output rate 1, so a sector's rare_earth "desired"
// = revenue / COMMODITY_BASE_PRICES.rare_earth. Keeps the headroom math hermetic.
vi.mock("@/lib/constants/sectorStrategies", () => ({
  SECTOR_STRATEGIES: {
    extraction: [{ id: "standard", supply: { rare_earth: 1 } }],
  },
}));

let db: MockDb;

function mockFind(collection: string, docs: unknown[]) {
  db.collection(collection);
  db.collectionMocks[collection]!.find.mockReturnValue({
    toArray: () => Promise.resolve(docs),
  } as never);
}

describe("computeResourceOpportunities", () => {
  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("ranks states by headroom desc and respects the limit", async () => {
    mockFind("stateResourceCapacity", [
      { stateId: "A", resources: { rare_earth: 100 } },
      { stateId: "B", resources: { rare_earth: 300 } },
      { stateId: "C", resources: { rare_earth: 200 } },
      { stateId: "D", resources: { rare_earth: 50 } },
    ]);
    mockFind("corporateSectors", []); // no demand anywhere -> headroom = capacity
    mockFind("states", [
      { _id: "A", countryId: "US" },
      { _id: "B", countryId: "US" },
      { _id: "C", countryId: "US" },
      { _id: "D", countryId: "US" },
    ]);

    const { computeResourceOpportunities } = await import("./extractionOpportunities");
    const result = await computeResourceOpportunities(
      db as unknown as Db,
      ["rare_earth"],
      "HOME",
      3
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.resource).toBe("rare_earth");
    expect(result[0]!.states.map((s) => s.stateId)).toEqual(["B", "C", "A"]);
    expect(result[0]!.states[0]!.headroom).toBe(300);
  });

  it("excludes the sector's own state", async () => {
    mockFind("stateResourceCapacity", [
      { stateId: "HOME", resources: { rare_earth: 9999 } },
      { stateId: "GOOD", resources: { rare_earth: 100 } },
    ]);
    mockFind("corporateSectors", []);
    mockFind("states", [
      { _id: "HOME", countryId: "US" },
      { _id: "GOOD", countryId: "US" },
    ]);

    const { computeResourceOpportunities } = await import("./extractionOpportunities");
    const result = await computeResourceOpportunities(db as unknown as Db, ["rare_earth"], "HOME");

    expect(result[0]!.states.map((s) => s.stateId)).toEqual(["GOOD"]);
  });

  it("drops fully-subscribed states (headroom <= 0) and zero-capacity states", async () => {
    mockFind("stateResourceCapacity", [
      { stateId: "ZERO", resources: { rare_earth: 0 } }, // no deposits -> dropped
      { stateId: "FULL", resources: { rare_earth: 10 } }, // demand exceeds cap -> dropped
      { stateId: "GOOD", resources: { rare_earth: 5000 } }, // room to grow -> kept
    ]);
    // A huge-revenue rare_earth sector in FULL drives desired (= revenue / rare_earth
    // base price) far above cap 10 for any plausible base price -> dropped.
    mockFind("corporateSectors", [{ stateId: "FULL", revenue: 1e12, strategyId: "standard" }]);
    mockFind("states", [
      { _id: "ZERO", countryId: "US" },
      { _id: "FULL", countryId: "US" },
      { _id: "GOOD", countryId: "US" },
    ]);

    const { computeResourceOpportunities } = await import("./extractionOpportunities");
    const result = await computeResourceOpportunities(db as unknown as Db, ["rare_earth"], "HOME");

    expect(result[0]!.states.map((s) => s.stateId)).toEqual(["GOOD"]);
  });

  it("returns [] when no resources are requested", async () => {
    const { computeResourceOpportunities } = await import("./extractionOpportunities");
    const result = await computeResourceOpportunities(db as unknown as Db, [], "HOME");
    expect(result).toEqual([]);
  });
});
