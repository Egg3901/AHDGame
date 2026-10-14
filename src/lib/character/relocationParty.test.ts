import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { relocationLeavesParty } from "./relocationParty";
import { PartyTerritoryError } from "@/lib/parties/relocationTerritory";

describe("relocation party reach", () => {
  it.each([
    { destination: "WA", leaves: false },
    { destination: "OR", leaves: false },
    { destination: "CA", leaves: true },
    { destination: "NY", leaves: true },
  ])("$destination departs: $leaves", async ({ destination, leaves }) => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue({
      toArray: async () => ["WA", "OR", "CA", "NY"].map((_id) => ({ _id })),
    });
    db.collection("characters").distinct.mockResolvedValue(["WA"]);
    expect(
      await relocationLeavesParty(
        db as unknown as Db,
        { _id: new ObjectId(), party: "7", countryId: "US" },
        { _id: destination, countryId: "US" }
      )
    ).toBe(leaves);
  });
  it("always leaves on country change, even with a colliding region id", async () => {
    const db = createMockDb();
    expect(
      await relocationLeavesParty(
        db as unknown as Db,
        { _id: new ObjectId(), party: "7", countryId: "DE" },
        { _id: "HB", countryId: "CN" }
      )
    ).toBe(true);
    expect(db.collection("states").find).toHaveBeenCalledWith(
      { countryId: "DE" },
      expect.anything()
    );
  });
  it("does not impose party departure on Independents", async () => {
    const db = createMockDb();
    expect(
      await relocationLeavesParty(
        db as unknown as Db,
        { _id: new ObjectId(), party: "independent", countryId: "US" },
        { _id: "NY", countryId: "US" }
      )
    ).toBe(false);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it.each(["US", "UK"] as const)(
    "blocks a bridge departure even when moving to %s",
    async (targetCountry) => {
      const mock = createMockDb();
      const id = new ObjectId();
      mock.collection("states").find.mockReturnValue({
        toArray: async () => ["WA", "OR", "CA", "ID"].map((_id) => ({ _id })),
      });
      mock
        .collection("characters")
        .distinct.mockImplementation(async (_field: string, filter: Record<string, unknown>) =>
          filter._id ? ["WA", "CA"] : ["WA", "OR", "CA"]
        );
      await expect(
        relocationLeavesParty(
          mock as unknown as Db,
          { _id: id, party: "7", countryId: "US" },
          { _id: "ID", countryId: targetCountry }
        )
      ).rejects.toBeInstanceOf(PartyTerritoryError);
    }
  );
});
