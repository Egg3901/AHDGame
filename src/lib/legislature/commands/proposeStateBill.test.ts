import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUserWithCharacter } from "@/lib/auth";

vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "onePartyState" }),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));

const characterId = new ObjectId();

function authUser(): AuthUserWithCharacter {
  return {
    userId: "u1",
    isAdmin: false,
    character: {
      _id: characterId,
      name: "Jack Ma",
      party: "1",
      actions: 50,
      nationalInfluence: 100,
    },
  } as unknown as AuthUserWithCharacter;
}

describe("proposeStateBill — industry subsidy bills", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "CN",
      _id: "ccp",
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      officeType: "peoplesCongress",
      state: "XB",
      characterId,
      countryId: "CN",
    });
    db.collection("stateBills").findOne.mockResolvedValue(null);
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("stateBills").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it("allows a CN provincial delegate to propose an economy-wide subsidy bill in Xibei", async () => {
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "CN", "xb", authUser(), {
      title: "Xibei Industrial Support Act",
      summary: "Grant a regional economy-wide subsidy.",
      category: "industry",
      provisions: [
        {
          type: "subsidy",
          scopeType: "economy_wide",
          domesticOnly: false,
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    const inserted = db.collection("stateBills").insertOne.mock.calls[0]?.[0] as {
      stateId: string;
      countryId: string;
      category: string;
      provisions: unknown[];
    };
    expect(inserted.stateId).toBe("XB");
    expect(inserted.countryId).toBe("CN");
    expect(inserted.category).toBe("industry");
    expect(inserted.provisions).toEqual([
      expect.objectContaining({ type: "subsidy", scopeType: "economy_wide", domesticOnly: false }),
    ]);
  });

  it("rejects sector-scoped subsidies without a target sector", async () => {
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "CN", "XB", authUser(), {
      title: "Incomplete Subsidy Bill",
      summary: "Missing sector target.",
      category: "industry",
      provisions: [{ type: "subsidy", scopeType: "sector", domesticOnly: false }],
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "Sector-scoped subsidy provisions must specify a target sector type.",
    });
    expect(db.collection("stateBills").insertOne).not.toHaveBeenCalled();
  });
});

describe("proposeStateBill — custom (flavor) bills", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "CN",
      _id: "ccp",
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      officeType: "peoplesCongress",
      state: "XB",
      characterId,
      countryId: "CN",
    });
    db.collection("stateBills").findOne.mockResolvedValue(null);
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("stateBills").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it("stores a custom state bill with empty provisions, stripping client input", async () => {
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "CN", "xb", authUser(), {
      title: "Xibei Appreciation Resolution",
      summary: "Xibei is wonderful.",
      category: "custom",
      // Smuggled provision must be ignored.
      provisions: [{ legislationTypeId: "smuggled-effect", effectDirection: 1 }],
    });

    expect(res.status).toBe(200);
    const inserted = db.collection("stateBills").insertOne.mock.calls[0]?.[0] as {
      category: string;
      provisions: unknown[];
      proposalNpiCost?: number;
    };
    expect(inserted.category).toBe("custom");
    expect(inserted.provisions).toEqual([]);
    expect(inserted.proposalNpiCost).toBeUndefined();
  });
});

describe("proposeStateBill — US state tax sliders (ticket #1106)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("legislationTypes");
    db.collection("stateBudgets");
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      _id: "d",
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      officeType: "stateSenate",
      state: "NC",
      characterId,
      countryId: "US",
    });
    db.collection("stateBills").findOne.mockResolvedValue(null);
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("stateBills").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
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

  it("stamps proposedRate and the rate-encoded option id on the stored provision", async () => {
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "US", "nc", authUser(), {
      title: "North Carolina Income Tax Act",
      summary: "Raise the state income tax.",
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
    const inserted = db.collection("stateBills").insertOne.mock.calls[0]?.[0] as {
      provisions: Array<Record<string, unknown>>;
    };
    expect(inserted.provisions[0]).toMatchObject({
      legislationTypeId: "us.tax.stateIncomeTax",
      proposedRate: 7,
      policyOptionId: "rate:7",
      effectDirection: 1,
    });
  });

  it("rejects a tax slider that does not move the live rate", async () => {
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "US", "NC", authUser(), {
      title: "No-op Tax Act",
      summary: "Leave the rate alone.",
      category: "tax",
      provisions: [
        {
          legislationTypeId: "us.tax.stateIncomeTax",
          proposedRate: 5,
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/at least/) });
    expect(db.collection("stateBills").insertOne).not.toHaveBeenCalled();
  });
});
