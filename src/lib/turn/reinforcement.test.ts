import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyReinforcement } from "./reinforcement";

function unit(over: Record<string, unknown> = {}) {
  return {
    _id: "u1",
    countryId: "US",
    domain: "ground",
    type: "Infantry Division", // establishment 12000
    personnel: 6000,
    vet: 2,
    xp: 50,
    theaterId: "reserve",
    ...over,
  };
}

describe("applyReinforcement", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("nationalManpower");
    db.collection("states");
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 100000,
      mode: "trained",
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", population: 10_000_000 }]),
    });
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([unit()]),
    });
  });

  it("regenerates the pool and tops up an under-strength unit", async () => {
    const out = await applyReinforcement(db as unknown as Db, "US");
    expect(out.regenerated).toBeGreaterThan(0);
    expect(out.reinforced).toBe(1);
    expect(out.drawn).toBeGreaterThan(0);
    expect(db.collectionMocks.militaryUnits.bulkWrite).toHaveBeenCalled();
  });

  it("does nothing when the mode is off", async () => {
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 100000,
      mode: "off",
    });
    const out = await applyReinforcement(db as unknown as Db, "US");
    expect(out.reinforced).toBe(0);
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
  });

  it("refuses the conscript mode when the stance does not permit it", async () => {
    // IE is not in the default stance table → 'limited', which forbids conscription,
    // so the surge falls back to the trained fill rate.
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "IE",
      pool: 100000,
      mode: "conscript",
    });
    const out = await applyReinforcement(db as unknown as Db, "IE");
    expect(out.drawn).toBe(1200); // trained 10% of 12000, not conscript 25%
  });

  it("never draws more than the pool holds", async () => {
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 300,
      mode: "trained",
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", population: 0 }]),
    });
    const out = await applyReinforcement(db as unknown as Db, "US");
    expect(out.drawn).toBeLessThanOrEqual(300);
  });

  it("leaves full-strength units alone", async () => {
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([unit({ personnel: 12000 })]),
    });
    const out = await applyReinforcement(db as unknown as Db, "US");
    expect(out.reinforced).toBe(0);
  });

  it("runs for a nation with no defense seat (simulated nations sustain forces too)", async () => {
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "PL", // no defense cabinet seat
      pool: 100000,
      mode: "trained",
    });
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([unit({ countryId: "PL" })]),
    });
    const out = await applyReinforcement(db as unknown as Db, "PL");
    expect(out.reinforced).toBe(1);
  });

  it("a repealed reserve law forbids the conscript surge", async () => {
    db.collection("statePolicies");
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({ policyOptionIndex: 0 });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 100000,
      mode: "conscript",
    });
    const out = await applyReinforcement(db as unknown as Db, "US");
    expect(out.drawn).toBe(1200); // trained rate, not the conscript 3000
  });

  it("a nation in arms sustains the conscript surge", async () => {
    db.collection("statePolicies");
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({ policyOptionIndex: 4 });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 100000,
      mode: "conscript",
    });
    const out = await applyReinforcement(db as unknown as Db, "US");
    expect(out.drawn).toBe(3000);
  });
});
