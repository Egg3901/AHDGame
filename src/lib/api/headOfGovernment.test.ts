import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

// Presidential branch resolves the head of government from electedOfficials.
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn(async () => ({ governmentType: "presidential" })),
}));

import { getHeadOfGovernmentCharacterId } from "./headOfGovernment";

describe("getHeadOfGovernmentCharacterId", () => {
  it("reads the president from electedOfficials, not the non-existent 'officials' collection", async () => {
    const charId = new ObjectId();
    const db = createMockDb();
    // Seed the electedOfficials president row.
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({ characterId: charId });
    // Only count collection accesses made by the function under test.
    db.collection.mockClear();

    const result = await getHeadOfGovernmentCharacterId(db as unknown as Db, "US");

    expect(db.collection).toHaveBeenCalledWith("electedOfficials");
    expect(db.collection).not.toHaveBeenCalledWith("officials");
    expect(result?.toString()).toBe(charId.toString());
  });

  it("resolves Romania's 2027 prime minister separately from its elected president", async () => {
    const pmId = new ObjectId();
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ preset: "2027-default" });
    db.collection("governmentFormations").findOne.mockResolvedValue({ pmCharacterId: pmId });

    const result = await getHeadOfGovernmentCharacterId(db as unknown as Db, "RO");

    expect(result?.toString()).toBe(pmId.toString());
    expect(db.collection("electedOfficials").findOne).not.toHaveBeenCalled();
  });
});
