import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { validateBillProvisions } from "./billProposal";
import { proposeBillSchema, stateBillProvisionSchema } from "@/lib/api/schemas/congress";

const ratify = { type: "european_treaty", treaty: "maastricht", action: "ratify" };
function world(turn = 55, stage = "community", members = ["DE", "UK"]) {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    currentTurn: turn,
    startingYear: 1991,
    preset: "1991-default",
    europeanIntegration: {
      stage,
      source: "historical-seed",
      establishedTurn: 1,
      ratifications: {},
    },
  });
  db.collection("organizationMemberships").find.mockReturnValue({
    toArray: async () => members.map((countryId) => ({ countryId })),
  });
  return db as unknown as Db;
}
describe("national Maastricht legislation", () => {
  it("accepts explicit ratification and rejection after the decision opens", async () => {
    for (const action of ["ratify", "reject"]) {
      const provision = { ...ratify, action };
      const result = await validateBillProvisions(world(), [provision], "foreign policy", "UK");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.europeanTreatyProvisions).toEqual([provision]);
    }
  });
  it("refuses premature, non-member, settled, duplicate and invalid decisions", async () => {
    for (const [db, provisions, category] of [
      [world(1), [ratify], "foreign policy"],
      [world(55, "community", ["DE"]), [ratify], "foreign policy"],
      [world(55, "union"), [ratify], "foreign policy"],
      [world(), [ratify, ratify], "foreign policy"],
      [world(), [ratify], "economy"],
      [world(), [{ ...ratify, action: "automatic" }], "foreign policy"],
    ] as const) {
      expect((await validateBillProvisions(db, [...provisions], category, "UK")).ok).toBe(false);
    }
  });
  it("accepts the national request schema but rejects regional treaty provisions", () => {
    expect(
      proposeBillSchema.safeParse({
        title: "Maastricht decision",
        summary: "Ratification vote",
        chamber: "commons",
        category: "foreign policy",
        provisions: [ratify],
      }).success
    ).toBe(true);
    expect(stateBillProvisionSchema.safeParse(ratify).success).toBe(false);
  });
});
