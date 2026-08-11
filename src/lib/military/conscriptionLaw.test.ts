import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resolveConscriptionStanceFor } from "./conscriptionLaw";
import { RESERVE_LAW_BY_COUNTRY } from "./manpower";
import { getLaw } from "@/lib/politicalLegislation/catalog";

// A typo'd law id would not throw — `getEnactedLevel` treats an unknown law as level 0,
// silently stripping the nation's manpower. Pin the ids against the real catalogue.
describe("reserve law ids resolve in the political-legislation catalogue", () => {
  it.each(Object.entries(RESERVE_LAW_BY_COUNTRY))("%s → %s exists", (countryId, lawId) => {
    const law = getLaw(lawId);
    expect(law).toBeTruthy();
    expect(law?.countryId).toBe(countryId);
    expect(law?.category).toBe("defense");
    // The ladder assumes exactly five rungs.
    expect(law?.levels).toHaveLength(5);
  });
});

describe("resolveConscriptionStanceFor", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePolicies");
  });

  it("uses the enacted reserve level for a playable nation", async () => {
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({ policyOptionIndex: 4 });
    const s = await resolveConscriptionStanceFor(db as unknown as Db, "US");
    expect(s.id).toBe("universal");
  });

  it("a repealed reserve law forbids conscription", async () => {
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({ policyOptionIndex: 0 });
    const s = await resolveConscriptionStanceFor(db as unknown as Db, "UK");
    expect(s.conscriptAllowed).toBe(false);
  });

  // Not yet legislated ⇒ getEnactedLevel falls back to the law's authored baseline (2).
  it("an unlegislated playable falls back to the law's baseline rung", async () => {
    db.collectionMocks.statePolicies.findOne.mockResolvedValue(null);
    const s = await resolveConscriptionStanceFor(db as unknown as Db, "RU");
    expect(s.id).toBe("selective");
  });

  // A simulated nation has no political laws at all. It must fall back to the default
  // table — NOT be read as level 0, which an unknown law id would yield.
  it("falls back to the default stance for a nation with no reserve law", async () => {
    const s = await resolveConscriptionStanceFor(db as unknown as Db, "PL");
    expect(s.id).toBe("limited");
    expect(db.collectionMocks.statePolicies.findOne).not.toHaveBeenCalled();
  });
});
