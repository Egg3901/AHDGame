import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("legislationTypes");
  db.collection("statePolicies");
  db.collection("enactedLaws");
});

describe("validateBillProvisions — embargo", () => {
  it("accepts a block embargo in a trade bill", async () => {
    const { validateBillProvisions } = await import("./billProposal");
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
    const { validateBillProvisions } = await import("./billProposal");
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
    const { validateBillProvisions } = await import("./billProposal");
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "embargo", targetCountry: "CN", commodity: "all", direction: "both", mode: "cap" }],
      "trade"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cap/i);
  });

  it("rejects an embargo outside a trade bill", async () => {
    const { validateBillProvisions } = await import("./billProposal");
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "end_embargo", targetCountry: "UK", commodity: "oil", direction: "export" }],
      "industry"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/trade bills/i);
  });

  it("rejects an embargo targeting the bill's own country", async () => {
    const { validateBillProvisions } = await import("./billProposal");
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
    const { validateBillProvisions } = await import("./billProposal");
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "embargo", targetCountry: "JP", commodity: "vehicles", direction: "import" }],
      "trade"
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.embargoProvisions[0]).toMatchObject({ mode: "block" });
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
    const { validateBillProvisions } = await import("./billProposal");
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
    const { validateBillProvisions } = await import("./billProposal");
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
    const { validateBillProvisions } = await import("./billProposal");
    const result = await validateBillProvisions(
      db as unknown as Db,
      [{ type: "union_law", bias: 0, banAction: "abolish" }],
      "industry"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("still restricts ban provisions to industry bills", async () => {
    const { validateBillProvisions } = await import("./billProposal");
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
    const { validateBillProvisions } = await import("./billProposal");
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
    const { validateBillProvisions } = await import("./billProposal");
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
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "uk_healthcare",
      name: "Healthcare",
      policyDomain: "healthcare",
      policyOptions: [{ id: "a", name: "A", effectDirection: -1, economic: -2, social: 0 }],
    });
    const { validateBillProvisions } = await import("./billProposal");
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
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "uk_healthcare",
      name: "Healthcare",
      policyDomain: "healthcare",
      policyOptions: [{ id: "a", name: "A", effectDirection: -1, economic: -2, social: 0 }],
    });
    const { validateBillProvisions } = await import("./billProposal");
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
