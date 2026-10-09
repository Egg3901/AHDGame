import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { BILL_PROPOSE_ACTION_COST, getProvisionCostTotal } from "@shared/constants/legislation";

vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "onePartyState" }),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/resetLegislation/loadReviewedCatalog", () => ({
  loadReviewedLawCatalog: vi.fn(),
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

  it("rejects stale reviewed drafts instead of silently stripping their provisions", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValueOnce({ currentTurn: 100 } as never);
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "CN", "XB", authUser(), {
      title: "Education and Health Act",
      summary: "A reviewed draft from an outdated form.",
      category: "custom",
      provisions: [
        {
          type: "reset_law",
          familyId: "education.core",
          scope: "regional",
          regionId: "XB",
          choice: "center",
        },
      ],
    });
    expect(res.status).toBe(409);
    expect(db.collection("stateBills").insertOne).not.toHaveBeenCalled();
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
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

  it("rejects the same reviewed regional tax instrument twice", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({
      _id: "current",
      currentTurn: 100,
      resetWorldId: "world-1",
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      resetVersionSeeds: {
        metrics: {
          worldId: "world-1",
          revision: 3,
          sourceTurn: 1,
          completedAt: "2026-10-04T00:00:00.000Z",
          verificationHash: "metrics",
        },
        legislation: {
          worldId: "world-1",
          revision: 6,
          sourceTurn: 1,
          completedAt: "2026-10-04T00:00:00.000Z",
          verificationHash: "legislation",
        },
      },
    } as never);
    const { proposeStateBill } = await import("./proposeStateBill");

    const res = await proposeStateBill(db as unknown as Db, "US", "NC", authUser(), {
      title: "Duplicated Income Tax Act",
      summary: "Attempts to set the same tax twice.",
      category: "tax",
      provisions: [
        { legislationTypeId: "us.tax.stateIncomeTax", proposedRate: 7 },
        { legislationTypeId: "us.tax.stateIncomeTax", proposedRate: 8 },
      ],
    });

    expect(res).toMatchObject({
      status: 400,
      body: { error: "A v2 bill cannot repeat a tax instrument." },
    });
    expect(db.collection("stateBills").insertOne).not.toHaveBeenCalled();
  });

  it("stores both reviewed education and health provisions in a custom UK regional bill", async () => {
    const { getGameState } = await import("@/lib/gameState");
    const { loadReviewedLawCatalog } = await import("@/lib/resetLegislation/loadReviewedCatalog");
    const gameState = {
      currentTurn: 100,
      resetWorldId: "world-1",
      startingYear: 1991,
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      resetVersionSeeds: Object.fromEntries(
        [
          ["metrics", 3],
          ["legislation", 6],
        ].map(([key, revision]) => [
          key,
          {
            worldId: "world-1",
            revision,
            sourceTurn: 1,
            completedAt: "2026-10-04T00:00:00.000Z",
            verificationHash: String(key),
          },
        ])
      ),
    };
    vi.mocked(getGameState).mockResolvedValueOnce(gameState as never);
    db.collection("gameState").findOne.mockResolvedValue(gameState);
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "UK",
      _id: "test-party",
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      countryId: "UK",
      state: "SCO",
      officeType: "regionalCouncil",
      characterId,
    });
    vi.mocked(loadReviewedLawCatalog).mockResolvedValueOnce(
      ["L10", "L19"].map((familyId) => ({
        familyId,
        currentLaw: "Current law",
        currentLawDescription: "Current description",
        options: [
          {
            option: { familyId, choice: "center_left" },
            currentChoice: "center",
            title: `${familyId} proposal`,
            description: "Proposed description",
          },
        ],
      })) as never
    );
    const { proposeStateBill } = await import("./proposeStateBill");
    const result = await proposeStateBill(db as unknown as Db, "UK", "SCO", authUser(), {
      title: "Education and Health Act",
      summary: "Improve education and health services.",
      category: "custom",
      provisions: ["L10", "L19"].map((familyId) => ({
        type: "reset_law",
        familyId,
        scope: "regional",
        regionId: "SCO",
        choice: "center_left",
      })),
    });
    expect(result).toMatchObject({ status: 200 });
    expect(db.collection("characters").updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: characterId }),
      expect.objectContaining({
        $inc: { actions: -BILL_PROPOSE_ACTION_COST, nationalInfluence: -getProvisionCostTotal(2) },
      })
    );
    expect(db.collection("stateBills").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "custom",
        proposalNpiCost: getProvisionCostTotal(2),
        proposalActionCost: BILL_PROPOSE_ACTION_COST,
        countryId: "UK",
        stateId: "SCO",
        provisions: ["L10", "L19"].map((familyId) =>
          expect.objectContaining({
            type: "reset_law",
            familyId,
            titleSnapshot: `${familyId} proposal`,
            choice: "center_left",
          })
        ),
      })
    );
  });

  it.each(["education", "custom"])(
    "validates reviewed %s provisions instead of stripping them",
    async (category) => {
      const { getGameState } = await import("@/lib/gameState");
      vi.mocked(getGameState).mockResolvedValue({
        _id: "current",
        currentTurn: 100,
        resetWorldId: "world-1",
        metricsSystemVersion: "v2",
        legislationSystemVersion: "v2",
        resetVersionSeeds: {
          metrics: {
            worldId: "world-1",
            revision: 3,
            sourceTurn: 1,
            completedAt: "2026-10-04T00:00:00.000Z",
            verificationHash: "metrics",
          },
          legislation: {
            worldId: "world-1",
            revision: 6,
            sourceTurn: 1,
            completedAt: "2026-10-04T00:00:00.000Z",
            verificationHash: "legislation",
          },
        },
      } as never);
      const { proposeStateBill } = await import("./proposeStateBill");

      const res = await proposeStateBill(db as unknown as Db, "US", "NC", authUser(), {
        title: "Malformed Regional Law Act",
        summary: "Omits the region from a reviewed regional law selection.",
        category,
        provisions: [
          {
            type: "reset_law",
            familyId: "education.core",
            scope: "regional",
            choice: "center",
          },
        ],
      });

      expect(res).toMatchObject({
        status: 400,
        body: { error: expect.stringMatching(/identify its family and region/i) },
      });
      expect(db.collection("stateBills").insertOne).not.toHaveBeenCalled();
    }
  );
});

describe("proposeStateBill — provision snapshots", () => {
  let db: MockDb;

  const LT = {
    _id: "ru_regional_health",
    name: "Regional Health Programme",
    policyDomain: "welfare",
    policyOptions: [
      { id: "o1", name: "Minimal", effectDirection: 1, explanation: "Token funding." },
      { id: "o2", name: "Universal", effectDirection: -1, explanation: "Full coverage." },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties").findOne.mockResolvedValue({
      sequentialId: 1,
      countryId: "RU",
      _id: "kprf",
    });
    db.collection("electedOfficials").findOne.mockResolvedValue({
      officeType: "regionalAssembly",
      state: "MOW",
      characterId,
      countryId: "RU",
    });
    db.collection("stateBills").findOne.mockResolvedValue(null);
    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collection("stateBills").insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collection("legislationTypes").find.mockReturnValue({ toArray: async () => [LT] });
    db.collection("statePolicies").find.mockReturnValue({
      toArray: async () => [
        { legislationTypeId: "ru_regional_health", policyOptionId: "o1", policyOptionIndex: 0 },
      ],
    });
    db.collection("enactedLaws").find.mockReturnValue({
      sort: () => ({ toArray: async () => [] }),
    });
  });

  it("freezes the current law on the stored provision", async () => {
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "RU", "mow", authUser(), {
      title: "Moscow Health Act",
      summary: "Expand regional health coverage.",
      category: "healthcare",
      provisions: [
        { legislationTypeId: "ru_regional_health", policyOptionId: "o2", effectDirection: -1 },
      ],
    });

    expect(res.status).toBe(200);
    const inserted = db.collection("stateBills").insertOne.mock.calls[0]?.[0] as {
      provisions: Array<Record<string, unknown>>;
    };
    expect(inserted.provisions[0]).toMatchObject({
      currentPolicyOptionIdSnapshot: "o1",
      currentPolicyOptionNameSnapshot: "Minimal",
      currentPolicyOptionExplanationSnapshot: "Token funding.",
      policyOptionNameSnapshot: "Universal",
      policyOptionExplanationSnapshot: "Full coverage.",
    });
  });

  it("keeps subsidy provisions in their original positions alongside policy ones", async () => {
    const { proposeStateBill } = await import("./proposeStateBill");
    const res = await proposeStateBill(db as unknown as Db, "RU", "mow", authUser(), {
      title: "Moscow Industry Act",
      summary: "Subsidise regional industry.",
      category: "industry",
      provisions: [
        { type: "subsidy", scopeType: "economy_wide", domesticOnly: false },
        { legislationTypeId: "ru_regional_health", policyOptionId: "o2", effectDirection: -1 },
      ],
    });

    expect(res.status).toBe(200);
    const inserted = db.collection("stateBills").insertOne.mock.calls[0]?.[0] as {
      provisions: Array<Record<string, unknown>>;
    };
    expect(inserted.provisions).toHaveLength(2);
    expect(inserted.provisions[0].type).toBe("subsidy");
    expect(inserted.provisions[1].currentPolicyOptionIdSnapshot).toBe("o1");
  });
});
