import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadRegionPolicyRecordPayload } from "./regionPolicyRecordPayload";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TRANSIT_TYPE = {
  _id: "us.infrastructure.transit.primary",
  countryScope: "us",
  name: "Transit Act",
  policyDomain: "infrastructure",
  policyOptions: [
    { id: "l0", name: "None", stance: "right", effectDirection: -1, economic: 3, social: 0 },
    { id: "l1", name: "Network", stance: "left", effectDirection: 1, economic: -3, social: 0 },
  ],
};

/** A state law in the shape state enactments actually take on live. */
function stateLaw(overrides: Record<string, unknown> = {}) {
  return {
    _id: "law-1",
    legislationTypeId: TRANSIT_TYPE._id,
    title: "Interstate Transit Act",
    scope: "state",
    countryId: "US",
    stateId: "GA",
    // NOTE: budgetCost + costModelV2, and NONE of the national cost fields.
    budgetCost: 0,
    costModelV2: { gdpCostFraction: 0.01 },
    policyOptionIndex: 1,
    budgetCategory: "infrastructure",
    enactedAt: new Date("1963-04-01T00:00:00Z"),
    enactedYear: 1963,
    ...overrides,
  };
}

function cursorOf(rows: unknown[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    project: vi.fn(() => cursor),
  };
  return cursor;
}

describe("loadRegionPolicyRecordPayload", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("legislationTypes").find = vi.fn(() => cursorOf([TRANSIT_TYPE]));
    db.collection("enactedLaws").find = vi.fn(() => cursorOf([stateLaw()]));
    db.collection("states").findOne = vi
      .fn()
      .mockResolvedValue({ _id: "GA", population: 5_500_000, gdp: 7_000 });
    db.collection("stateBudgets").findOne = vi
      .fn()
      .mockResolvedValue({ _id: "GA", stateGdp: 7_000, spending: { total: 1_000_000 } });
    db.collection("electedOfficials").findOne = vi.fn().mockResolvedValue(null);
    db.collection("characters").findOne = vi.fn().mockResolvedValue(null);
  });

  async function load(regionId = "GA") {
    return loadRegionPolicyRecordPayload("US", regionId, db as unknown as Db);
  }

  it("scopes the enacted-law read to this region only", async () => {
    await load();
    const find = db.collectionMocks.enactedLaws.find as ReturnType<typeof vi.fn>;
    expect(find).toHaveBeenCalledWith({
      scope: "state",
      stateId: "GA",
      repealedAt: { $exists: false },
    });
  });

  it("records provenance for the region's own laws", async () => {
    const out = await load();
    expect(out.provenance[TRANSIT_TYPE._id]).toMatchObject({
      title: "Interstate Transit Act",
      enactedYear: 1963,
    });
  });

  it("computes annual cost from costModelV2 against the REGION's own economy", async () => {
    // The national helper returns null on this exact shape (budgetCost +
    // costModelV2, none of gdpCostFraction / annualCostPerCapita /
    // annualCostUsd / gdpPerCapitaMultiplier), which would render every state
    // law as free. 0.01 x 7,000M = 70M.
    const out = await load();
    expect(out.provenance[TRANSIT_TYPE._id].annualCost).toBeCloseTo(70_000_000, 0);
  });

  it("prices a legacy percentage-of-budget law against the region budget", async () => {
    db.collection("enactedLaws").find = vi.fn(() =>
      cursorOf([stateLaw({ costModelV2: undefined, budgetCost: 5 })])
    );
    const out = await load();
    // 5% of a 1,000,000 state budget.
    expect(out.provenance[TRANSIT_TYPE._id].annualCost).toBe(50_000);
  });

  it("returns an empty record for a region that has enacted nothing", async () => {
    db.collection("enactedLaws").find = vi.fn(() => cursorOf([]));
    const out = await load("WY");
    // 81 of 116 regions are in exactly this state, so it is the common case.
    expect(out.points).toEqual([]);
    expect(out.events).toEqual([]);
    expect(out.provenance).toEqual({});
  });

  it("names the era after the region's own executive, not the president", async () => {
    db.collection("electedOfficials").findOne = vi
      .fn()
      .mockResolvedValue({ characterId: "c1", electedAt: new Date("1962-01-01T00:00:00Z") });
    db.collection("characters").findOne = vi.fn().mockResolvedValue({ name: "Ariane Yeong" });
    const out = await load();
    expect(out.era?.label).toBe("Yeong administration");
  });

  it("leaves the era null when the regional seat is vacant", async () => {
    // An invented administration label is worse than no era line at all.
    const out = await load();
    expect(out.era).toBeNull();
  });
});
