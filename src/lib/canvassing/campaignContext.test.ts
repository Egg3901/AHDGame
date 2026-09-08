import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { canUseNativeCanvassTargets } from "./campaignContext";

describe("canvassing race context", () => {
  it.each([
    { races: [], expected: true },
    { races: [{ campaignRulesVersion: 1 }], expected: true },
    { races: [{ campaignRulesVersion: 1 }, {}], expected: false },
    { races: [{}], expected: false },
  ])("uses targets shared by all affected races: $races", async ({ races, expected }) => {
    const db = createMockDb();
    db.collection("elections").find.mockReturnValue({ toArray: async () => races });
    expect(await canUseNativeCanvassTargets(db as unknown as Db, "UK", "LON")).toBe(expected);
  });
  it("scopes an explicit campaign race by country, region and active status", async () => {
    const db = createMockDb();
    const id = new ObjectId();
    db.collection("elections").find.mockReturnValue({
      toArray: async () => [{ campaignRulesVersion: 1 }],
    });
    expect(await canUseNativeCanvassTargets(db as unknown as Db, "UK", "LON", id.toString())).toBe(
      true
    );
    expect(db.collection("elections").find).toHaveBeenCalledWith(
      { _id: id, countryId: "UK", status: "active", state: { $in: ["LON", "UK"] } },
      expect.anything()
    );
  });
});
