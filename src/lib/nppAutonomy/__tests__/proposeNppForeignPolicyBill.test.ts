import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { proposeNppForeignPolicyBill } from "../proposeNppForeignPolicyBill";

const now = new Date("2026-08-28T01:10:00.000Z");
const head = { _id: new ObjectId(), name: "French Premier" } as NPP;
const sponsorId = new ObjectId();

function setup(): MockDb {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    preset: "1953-default",
  });
  db.collection("governmentFormations").findOne.mockResolvedValue({
    _id: "FR",
    status: "formed",
    governingPartyId: "1",
  });
  db.collection("electedOfficials").findOne.mockResolvedValue({
    _id: "fr-seat-1",
    countryId: "FR",
    officeType: "depute",
    party: "1",
    nppId: sponsorId,
  });
  db.collection("npps").findOne.mockResolvedValue({
    _id: sponsorId,
    name: "Government Deputy",
    party: "1",
  });
  db.collection("bills").findOne.mockResolvedValue(null);
  db.collection("tariffs").findOne.mockResolvedValue(null);
  db.collection("bills").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  return db;
}

describe("proposeNppForeignPolicyBill", () => {
  it("introduces a targeted tariff through the era-aware national chamber", async () => {
    const db = setup();

    const result = await proposeNppForeignPolicyBill(
      db as unknown as Db,
      "FR",
      head,
      "raise_tariff",
      "RU",
      30,
      now
    );

    expect(result.ok).toBe(true);
    expect(db.collection("electedOfficials").findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "FR",
        party: "1",
        nppId: { $exists: true },
      }),
      expect.anything()
    );
    const bill = db.collection("bills").insertOne.mock.calls[0][0];
    expect(bill).toMatchObject({
      countryId: "FR",
      category: "trade",
      originChamber: "assembleeNationale",
      currentChamber: "assembleeNationale",
      sponsorId,
      sponsorParty: "1",
      nppSponsored: true,
      status: "active",
      votingEndsOnTurn: 54,
      provisions: [
        {
          type: "tariff",
          scopeType: "origin_country",
          targetOriginCountryId: "RU",
          rate: 15,
        },
      ],
    });
  });

  it("uses a zero-rate bill to remove an existing targeted tariff", async () => {
    const db = setup();
    db.collection("tariffs").findOne.mockResolvedValue({ rate: 25 });

    const result = await proposeNppForeignPolicyBill(
      db as unknown as Db,
      "FR",
      head,
      "lower_tariff",
      "RU",
      31,
      now
    );

    expect(result.ok).toBe(true);
    expect(db.collection("bills").insertOne.mock.calls[0][0].provisions[0].rate).toBe(0);
  });

  it("refuses to bypass parliament when the governing party has no seated sponsor", async () => {
    const db = setup();
    db.collection("electedOfficials").findOne.mockResolvedValue(null);

    const result = await proposeNppForeignPolicyBill(
      db as unknown as Db,
      "FR",
      head,
      "raise_tariff",
      "RU",
      32,
      now
    );

    expect(result).toEqual({
      ok: false,
      reason: "The governing party has no seated NPP bill sponsor.",
    });
    expect(db.collection("bills").insertOne).not.toHaveBeenCalled();
  });
});
