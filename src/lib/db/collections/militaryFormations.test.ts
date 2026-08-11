import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getMilitaryFormations } from "./militaryFormations";

describe("getMilitaryFormations", () => {
  it("returns empty defaults when the country has no org doc", async () => {
    const db = createMockDb();
    db.collection("militaryFormations");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    expect(await getMilitaryFormations(db as unknown as Db, "US")).toEqual({
      conflictAssignments: [],
      positions: {},
    });
  });

  it("returns the stored assignments + positions when present", async () => {
    const db = createMockDb();
    db.collection("militaryFormations");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      positions: { u1: "frontline" },
      conflictAssignments: [
        { theaterId: "afghan", generalCharacterId: "g1", inCharge: true, unitIds: ["u1"] },
      ],
    });
    const r = await getMilitaryFormations(db as unknown as Db, "US");
    expect(r.positions).toEqual({ u1: "frontline" });
    expect(r.conflictAssignments).toHaveLength(1);
    expect(r.conflictAssignments[0].generalCharacterId).toBe("g1");
  });

  // Docs written before the assignment layer existed still carry the retired
  // `formations` array. They must read back as "no assignments", not undefined —
  // battle math and the route both iterate this without null-checking.
  it("defaults assignments to [] for a pre-W7 doc carrying the retired formations array", async () => {
    const db = createMockDb();
    db.collection("militaryFormations");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      formations: [{ id: "f1", name: "1st", doctrine: "d", unitIds: ["u1"], general: null }],
      positions: { u1: "frontline" },
    });
    const r = await getMilitaryFormations(db as unknown as Db, "US");
    expect(r.conflictAssignments).toEqual([]);
    expect(r.positions).toEqual({ u1: "frontline" });
  });
});
