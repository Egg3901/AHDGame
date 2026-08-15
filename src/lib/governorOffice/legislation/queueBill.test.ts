import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { queueBill } from "./queueBill";

const characterId = new ObjectId();
const nppId = new ObjectId();

describe("queueBill — US state tax sliders (ticket #1106)", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("governorLegislationQueue").findOne.mockResolvedValue(null);
    db.collection("npps").findOne.mockResolvedValue({
      _id: nppId,
      name: "NPP Legislator",
      party: "1",
      retiredAt: null,
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      nppId,
      officeType: "stateSenate",
      state: "NC",
    });
    db.collection("stateBills").findOne.mockResolvedValue(null);
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("governorLegislationQueue").insertOne.mockResolvedValue({ insertedId: nppId });
    db.collection("legislationTypes");
    db.collection("stateBudgets");
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "us.tax.stateIncomeTax",
      taxSlider: {
        scope: "state",
        taxType: "incomeTax",
        minRate: 0,
        maxRate: 25,
        step: 0.5,
        baselineRate: 5,
        waypoints: [],
      },
    });
    db.collectionMocks.stateBudgets.findOne.mockResolvedValue({
      taxRates: { incomeTax: 5 },
    });
  });

  it("stamps proposedRate on a queued governor tax bill", async () => {
    const res = await queueBill(db as unknown as Db, {
      countryId: "US",
      stateId: "NC",
      character: { _id: characterId, name: "Gov", party: "1" },
      targetNppId: nppId,
      title: "Raise NC Income Tax",
      summary: "A hike.",
      category: "tax",
      provisions: [
        {
          legislationTypeId: "us.tax.stateIncomeTax",
          effectDirection: 1,
          proposedRate: 7,
        },
      ],
    });

    expect(res.status).toBe(200);
    const inserted = db.collection("governorLegislationQueue").insertOne.mock.calls[0]?.[0] as {
      provisions: Array<Record<string, unknown>>;
    };
    expect(inserted.provisions[0]).toMatchObject({
      legislationTypeId: "us.tax.stateIncomeTax",
      proposedRate: 7,
      policyOptionId: "rate:7",
      effectDirection: 1,
    });
  });

  it("rejects a queued tax slider that does not move the live rate", async () => {
    const res = await queueBill(db as unknown as Db, {
      countryId: "US",
      stateId: "NC",
      character: { _id: characterId, name: "Gov", party: "1" },
      targetNppId: nppId,
      title: "No-op",
      summary: "Stay put.",
      category: "tax",
      provisions: [
        { legislationTypeId: "us.tax.stateIncomeTax", effectDirection: 0, proposedRate: 5 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least/);
    expect(db.collection("governorLegislationQueue").insertOne).not.toHaveBeenCalled();
  });
});
