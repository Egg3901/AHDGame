import { validateBillProvisions } from "./billProposal";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("legislationTypes");
  db.collection("statePolicies");
  db.collection("enactedLaws");
  db.collection("gameState");
  db.collection("gameConfig");
  db.collection("corporateSectors");
  db.collection("bankMoneyMoves");
});

describe("validateBillProvisions: reset version isolation", () => {
  it("rejects legacy provisions when legislation v2 is active", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
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
    });

    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "tariff", scopeType: "economy_wide", rate: 10 }],
      "trade",
      "US"
    );

    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toMatch(/only reviewed legislation v2/i);
  });

  it("rejects a null reviewed provision without throwing", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
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
    });

    const result = await validateBillProvisions(db as unknown as Db, [null], "custom", "JP");

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "Each provision must have a legislation type.",
    });
  });

  it("accepts an exact-rate JP tax from the reviewed v2 tax catalog", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
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
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "jp_foreign_corporation_tax",
          name: "Foreign Corporation Tax Act",
          countryScope: "jp",
          policyDomain: "tax",
          taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
          policyOptions: [
            { id: "zero", name: "0%", rate: 0 },
            { id: "maximum", name: "65%", rate: 65 },
          ],
        },
      ],
    });
    db.collection("federalBudget");
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "JP",
      taxRates: { foreignCorporateTax: 23 },
    });

    const result = await validateBillProvisions(
      db as unknown as Db,
      [
        {
          legislationTypeId: "jp_foreign_corporation_tax",
          proposedRate: 27.25,
          effectDirection: 0,
        },
      ],
      "tax",
      "JP"
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policyProvisions).toEqual([
        expect.objectContaining({
          legislationTypeId: "jp_foreign_corporation_tax",
          proposedRate: 27.25,
          policyOptionId: "rate:27.25",
          currentPolicyOptionNameSnapshot: "Rate: 23%",
          policyOptionNameSnapshot: "Rate: 27.25%",
        }),
      ]);
    }
  });

  it("rejects the same reviewed tax instrument twice in one bill", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
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
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "jp_foreign_corporation_tax",
          name: "Foreign Corporation Tax Act",
          countryScope: "jp",
          policyDomain: "tax",
          taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
          policyOptions: [
            { id: "zero", name: "0%", rate: 0 },
            { id: "maximum", name: "65%", rate: 65 },
          ],
        },
      ],
    });
    db.collection("federalBudget").findOne.mockResolvedValue({
      _id: "JP",
      taxRates: { foreignCorporateTax: 23 },
    });

    const result = await validateBillProvisions(
      db as unknown as Db,
      [
        {
          legislationTypeId: "jp_foreign_corporation_tax",
          proposedRate: 27.25,
          effectDirection: 0,
        },
        {
          legislationTypeId: "jp_foreign_corporation_tax",
          proposedRate: 28,
          effectDirection: 0,
        },
      ],
      "tax",
      "JP"
    );

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "A v2 bill cannot repeat a tax instrument.",
    });
  });
});

describe("validateBillProvisions — embargo", () => {
  it("accepts a block embargo in a trade bill", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [
        {
          type: "embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "block",
        },
      ],
      "trade"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.embargoProvisions).toEqual([
        {
          type: "embargo",
          targetCountry: "DE",
          commodity: "steel",
          direction: "both",
          mode: "block",
        },
      ]);
      expect(result.tariffProvisions).toEqual([]);
    }
  });

  it("keeps the cap on a capped embargo", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [
        {
          type: "embargo",
          targetCountry: "CN",
          commodity: "all",
          direction: "import",
          mode: "cap",
          cap: 2500,
        },
      ],
      "trade"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.embargoProvisions[0]).toMatchObject({ mode: "cap", cap: 2500 });
    }
  });

  it("rejects a capped embargo with no cap", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "embargo", targetCountry: "CN", commodity: "all", direction: "both", mode: "cap" }],
      "trade"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cap/i);
  });

  it("rejects an embargo outside a trade bill", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "end_embargo", targetCountry: "UK", commodity: "oil", direction: "export" }],
      "industry"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/trade bills/i);
  });

  it("rejects an embargo targeting the bill's own country", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [
        {
          type: "embargo",
          targetCountry: "US",
          commodity: "all",
          direction: "both",
          mode: "block",
        },
      ],
      "trade",
      "US"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/itself/i);
  });

  it("defaults mode to block when omitted", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "embargo", targetCountry: "JP", commodity: "vehicles", direction: "import" }],
      "trade"
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.embargoProvisions[0]).toMatchObject({ mode: "block" });
  });
});

describe("validateBillProvisions: media ownership availability", () => {
  const provision = {
    legislationTypeId: "us_media_communications",
    policyOptionId: "media_ownership_cap",
    effectDirection: 1,
    economic: -1,
  };

  it("rejects ownership legislation until delivered concentration exceeds the trigger", async () => {
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "us_media_communications",
          name: "Media and Communications Regulation Act",
          policyDomain: "mediaInformation",
          policyOptions: [],
        },
      ],
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1991,
      currentTurn: 12,
      eraSystemEnabled: true,
      mediaRegulationSnapshot: {
        enabled: true,
        marketSystemMode: "clearing",
        commandEconomyEnabled: false,
      },
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "sector-a",
          stateId: "CA",
          corporationId: { toString: () => "corp-a" },
          sectorType: "media",
          strategyId: "standard",
          producedUnits: 100,
          soldByCommodity: { advertising: 0.6 },
          soldByCommodityTurn: 12,
        },
        {
          _id: "sector-b",
          stateId: "CA",
          corporationId: { toString: () => "corp-b" },
          sectorType: "media",
          strategyId: "standard",
          producedUnits: 100,
          soldByCommodity: { advertising: 0.4 },
          soldByCommodityTurn: 12,
        },
      ],
    } as never);

    const result = await validateBillProvisions(db as unknown as Db, [provision], "social", "US");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeds 65%/);
  });

  it("does not load sector concentration data with regulation disabled", async () => {
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "us_media_communications",
          name: "Media and Communications Regulation Act",
          policyDomain: "mediaInformation",
          policyOptions: [],
        },
      ],
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      mediaRegulationSnapshot: {
        enabled: false,
        marketSystemMode: "clearing",
        commandEconomyEnabled: false,
      },
    });

    const result = await validateBillProvisions(db as unknown as Db, [provision], "social", "US");

    expect(result.ok).toBe(true);
    expect(db.collectionMocks.corporateSectors.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameConfig.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.bankMoneyMoves.find).not.toHaveBeenCalled();
    // Era context and reset-version isolation each use a narrow game-state read.
    expect(db.collectionMocks.gameState.findOne).toHaveBeenCalledTimes(2);
  });
});

describe("snapshotBillPolicyProvisions", () => {
  it("freezes proposed and current option labels from proposal time", async () => {
    const { snapshotBillPolicyProvisions } = await import("./billProposal");

    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "family_policy",
          name: "Family Policy",
          policyOptions: [
            {
              id: "family_current",
              name: "Current Law",
              explanation: "Current Law: Existing policy before the bill",
              effectDirection: 0,
              economic: 0,
              social: 0,
            },
            {
              id: "family_proposed",
              name: "Proposed Law",
              explanation: "Proposed Law: Expanded childcare support",
              effectDirection: 0,
              economic: -1,
              social: 0,
            },
          ],
        },
      ],
    });
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: async () => [
        {
          stateId: "jp_national",
          legislationTypeId: "family_policy",
          policyOptionId: "family_current",
        },
      ],
    });

    const result = await snapshotBillPolicyProvisions(
      db as unknown as Db,
      { scope: "national", countryId: "JP" },
      [
        {
          legislationTypeId: "family_policy",
          policyOptionId: "family_proposed",
          effectDirection: 0,
          economic: -1,
          social: 0,
        },
      ]
    );

    // Both fixtures' explanations contain ": ", which is exactly the case the old
    // combiner mishandled: it returned the explanation ALONE and dropped
    // option.name, so the stored snapshot lost the law's actual option title.
    // Structured snapshots keep both fields.
    expect(result).toEqual([
      {
        legislationTypeId: "family_policy",
        policyOptionId: "family_proposed",
        policyOptionNameSnapshot: "Proposed Law",
        policyOptionExplanationSnapshot: "Proposed Law: Expanded childcare support",
        currentPolicyOptionIdSnapshot: "family_current",
        currentPolicyOptionNameSnapshot: "Current Law",
        currentPolicyOptionExplanationSnapshot: "Current Law: Existing policy before the bill",
        effectDirection: 0,
        economic: -1,
        social: 0,
      },
    ]);
  });
});

describe("validateBillProvisions — union_law ban action (player suggestion #93)", () => {
  it("accepts a ban provision in an industry bill (bias normalized to 0)", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "union_law", bias: 30, banAction: "ban" }],
      "industry"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unionLawProvisions).toEqual([{ type: "union_law", bias: 0, banAction: "ban" }]);
    }
  });

  it("accepts a repeal_ban provision", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "union_law", bias: 0, banAction: "repeal_ban" }],
      "industry"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.unionLawProvisions).toEqual([
        { type: "union_law", bias: 0, banAction: "repeal_ban" },
      ]);
    }
  });

  it("rejects an unknown banAction value", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "union_law", bias: 0, banAction: "abolish" }],
      "industry"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("still restricts ban provisions to industry bills", async () => {
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "union_law", bias: 0, banAction: "ban" }],
      "trade"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("declare-war provisions are refused on the legislator path", () => {
  it("refuses a declaration smuggled into an ordinary bill", async () => {
    // This route only checks that the proposer holds a seat. Accepting a
    // declaration here would let any backbencher bypass the executive gate on
    // /executive/declare-war by hand-rolling the provision.
    const r = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "declare_war", targetCountry: "CN", warGoal: "punitive" }],
      "foreign_policy",
      "US"
    );
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/head of government|defence minister/i);
  });

  it("refuses it whatever the category", async () => {
    const r = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "declare_war", targetCountry: "CN", warGoal: "punitive" }],
      "general",
      "US"
    );
    expect(r.ok).toBe(false);
  });
});

describe("validateBillProvisions — policy axis zeros (ticket #1116)", () => {
  it("omits economic and social when they are missing or zero", async () => {
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "uk_healthcare",
          name: "Healthcare",
          policyDomain: "healthcare",
          policyOptions: [{ id: "a", name: "A", effectDirection: -1, economic: -2, social: 0 }],
        },
      ],
    });
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ legislationTypeId: "uk_healthcare", effectDirection: -1, economic: 0, social: 0 }],
      "healthcare"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policyProvisions[0]).toEqual({
        legislationTypeId: "uk_healthcare",
        effectDirection: -1,
      });
    }
  });

  it("keeps a non-zero axis and still omits a zero axis", async () => {
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "uk_healthcare",
          name: "Healthcare",
          policyDomain: "healthcare",
          policyOptions: [{ id: "a", name: "A", effectDirection: -1, economic: -2, social: 0 }],
        },
      ],
    });
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ legislationTypeId: "uk_healthcare", effectDirection: -1, economic: -2, social: 0 }],
      "healthcare"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policyProvisions[0]).toEqual({
        legislationTypeId: "uk_healthcare",
        effectDirection: -1,
        economic: -2,
      });
    }
  });
});

describe("validateBillProvisions: euro adoption", () => {
  beforeEach(() => {
    db.collection("gameState").findOne.mockResolvedValue({ currentYear: 1999 });
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: async () => [{ countryId: "DE" }, { countryId: "IE" }, { countryId: "UK" }],
    });
  });
  it.each(["DE", "IE", "UK"] as const)(
    "retains a standalone adoption vote for %s",
    async (country) => {
      const { validateBillProvisions } = await import("./billProposal");
      const result = await validateBillProvisions(
        db as unknown as Db,
        [{ type: "euro_adoption" }],
        "economy",
        country
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.euroAdoptionProvisions).toEqual([{ type: "euro_adoption" }]);
        expect(result.policyProvisions).toEqual([]);
      }
    }
  );
  it("rejects ineligible countries and missing jurisdiction", async () => {
    const { validateBillProvisions } = await import("./billProposal");
    for (const country of ["US", undefined] as const) {
      expect(
        (
          await validateBillProvisions(
            db as unknown as Db,
            [{ type: "euro_adoption" }],
            "economy",
            country
          )
        ).ok
      ).toBe(false);
    }
  });
  it("rejects the wrong category and duplicate adoption provisions", async () => {
    const { validateBillProvisions } = await import("./billProposal");
    expect(
      (
        await validateBillProvisions(
          db as unknown as Db,
          [{ type: "euro_adoption" }],
          "social",
          "DE"
        )
      ).ok
    ).toBe(false);
    expect(
      (
        await validateBillProvisions(
          db as unknown as Db,
          [{ type: "euro_adoption" }, { type: "euro_adoption" }],
          "economy",
          "DE"
        )
      ).ok
    ).toBe(false);
  });
  it.each([{ eurozoneEnabled: true }, { euroAdoptedCountries: ["DE"] }])(
    "rejects a country whose adoption is already recorded",
    async (state) => {
      db.collection("gameState").findOne.mockResolvedValue({ currentYear: 1999, ...state });
      const { validateBillProvisions } = await import("./billProposal");
      expect(
        (
          await validateBillProvisions(
            db as unknown as Db,
            [{ type: "euro_adoption" }],
            "economy",
            "DE"
          )
        ).ok
      ).toBe(false);
    }
  );
});

it("rejects a national rate-setting independence proposal after euro accession", async () => {
  const { planEuroSettlement } = await import("@/lib/currency/euro/rules");
  const { validateBillProvisions } = await import("./billProposal");
  const union = planEuroSettlement({
    year: 1999,
    turn: 385,
    preset: "1991-default",
    europeanMembers: ["DE", "IE", "UK"],
    consentedCountries: ["DE", "IE", "UK"],
    rates: { EUR: 0.8, IEP: 0.7, GBP: 0.6 },
  }).union;
  db.collection("gameState").findOne.mockResolvedValue({ euroMonetaryUnion: union });
  const result = await validateBillProvisions(
    db as unknown as Db,
    [{ type: "central_bank_independence", action: "revoke" }],
    "economy",
    "UK"
  );
  expect(result).toMatchObject({
    ok: false,
    status: 400,
    error: expect.stringContaining("shared institution"),
  });
});

describe("economic system reform provisions", () => {
  let reformDb: MockDb;
  beforeEach(() => {
    reformDb = createMockDb();
  });

  it("accepts a reform on an economy bill in a planned-era country", async () => {
    const result = await validateBillProvisions(
      reformDb as unknown as Db,
      [{ type: "economic_system_reform", target: "market" }],
      "economy",
      "DD"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.economicSystemReformProvisions).toEqual([
        { type: "economic_system_reform", target: "market" },
      ]);
    }
  });

  it("refuses a market country", async () => {
    const result = await validateBillProvisions(
      reformDb as unknown as Db,
      [{ type: "economic_system_reform", target: "command" }],
      "economy",
      "US"
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses other bill categories, unknown targets and duplicates", async () => {
    for (const [provisions, category] of [
      [[{ type: "economic_system_reform", target: "market" }], "social"],
      [[{ type: "economic_system_reform", target: "anarchy" }], "economy"],
      [
        [
          { type: "economic_system_reform", target: "market" },
          { type: "economic_system_reform", target: "dual_track" },
        ],
        "economy",
      ],
    ] as const) {
      const result = await validateBillProvisions(
        reformDb as unknown as Db,
        provisions as unknown as unknown[],
        category,
        "DD"
      );
      expect(result.ok).toBe(false);
    }
  });
});
