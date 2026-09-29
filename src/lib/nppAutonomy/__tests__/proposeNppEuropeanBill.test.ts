import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { proposeNppEuropeanBill } from "../proposeNppEuropeanBill";
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "parliamentary" }),
}));

function world(stage: "community" | "union" = "community") {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    currentYear: 1999,
    currentTurn: 385,
    startingYear: 1991,
    preset: "1991-default",
    eurozoneEnabled: false,
    europeanIntegration: {
      stage,
      source: "historical-seed",
      establishedTurn: 1,
      ratifications: {},
    },
  });
  db.collection("organizationMemberships").find.mockReturnValue({
    toArray: async () => [{ _id: new ObjectId(), countryId: "UK", joinedTurn: 1 }],
  });
  const sponsor = { _id: new ObjectId(), name: "Government Member", party: "1" };
  const official = {
    countryId: "UK" as const,
    nppId: sponsor._id,
    officeType: getLowerChamberOfficeType("UK"),
  };
  return { db, sponsor, official };
}

describe("NPP European proposal", () => {
  it("introduces a normal national bill without writing ratification", async () => {
    const { db, sponsor, official } = world();
    expect(
      await proposeNppEuropeanBill(
        db as unknown as Db,
        "UK",
        sponsor,
        official,
        { kind: "maastricht", action: "ratify", reasons: ["Party supports integration."] },
        385,
        new Date()
      )
    ).toBe(true);
    expect(db.collection("bills").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        countryId: "UK",
        sponsorId: sponsor._id,
        proposedTurn: 385,
        votesFor: 0,
        provisions: [{ type: "european_treaty", treaty: "maastricht", action: "ratify" }],
      })
    );
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });
  it("does not duplicate an active or recently attempted decision", async () => {
    const { db, sponsor, official } = world();
    db.collection("bills").findOne.mockResolvedValue({ _id: new ObjectId() });
    expect(
      await proposeNppEuropeanBill(
        db as unknown as Db,
        "UK",
        sponsor,
        official,
        { kind: "maastricht", action: "ratify", reasons: [] },
        385,
        new Date()
      )
    ).toBe(false);
    expect(db.collection("bills").insertOne).not.toHaveBeenCalled();
  });
  it("rejects a foreign or unseated sponsor", async () => {
    const { db, sponsor, official } = world();
    expect(
      await proposeNppEuropeanBill(
        db as unknown as Db,
        "UK",
        sponsor,
        { ...official, countryId: "IE" },
        { kind: "maastricht", action: "ratify", reasons: [] },
        385,
        new Date()
      )
    ).toBe(false);
    expect(db.collection("bills").insertOne).not.toHaveBeenCalled();
  });
});

describe("NPP monetary authorization", () => {
  it.each(["community", "union"] as const)(
    "requires Union settlement at %s stage",
    async (stage) => {
      const { db, sponsor, official } = world(stage);
      expect(
        await proposeNppEuropeanBill(
          db as unknown as Db,
          "UK",
          sponsor,
          official,
          { kind: "euro", action: "ratify", reasons: ["Party supports accession."] },
          385,
          new Date()
        )
      ).toBe(stage === "union");
      if (stage === "union")
        expect(db.collection("bills").insertOne).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "active",
            votesFor: 0,
            provisions: [{ type: "euro_adoption" }],
          })
        );
      else expect(db.collection("bills").insertOne).not.toHaveBeenCalled();
      expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
    }
  );
});
