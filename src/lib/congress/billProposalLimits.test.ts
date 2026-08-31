import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  // Initialize collections used by the helpers so collectionMocks has entries
  db.collection("bills");
  db.collection("stateBills");
  db.collection("statePolicies");
  db.collection("legislationTypes");
  vi.clearAllMocks();
});

describe("checkDuplicateProvisions", () => {
  async function loadHelper() {
    const { checkDuplicateProvisions } = await import("./billProposalLimits");
    return checkDuplicateProvisions;
  }

  it("returns null when no provisions have policyOptionId", async () => {
    const check = await loadHelper();
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "US", status: { $nin: ["failed"] } },
      [{ legislationTypeId: "income_tax" }]
    );
    expect(result).toBeNull();
  });

  it("returns null when no active bills exist", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "US", status: { $nin: ["failed"] } },
      [{ legislationTypeId: "income_tax", policyOptionId: "opt_3" }]
    );
    expect(result).toBeNull();
  });

  it("detects duplicate provision at same level", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            { legislationTypeId: "income_tax", policyOptionId: "opt_3", effectDirection: 0 },
          ],
        },
      ]),
    });
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "income_tax",
      name: "Income Tax",
    });

    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "US", status: { $nin: ["failed"] } },
      [{ legislationTypeId: "income_tax", policyOptionId: "opt_3" }]
    );
    expect(result).not.toBeNull();
    expect(result!.error).toContain("Income Tax");
    expect(result!.error).toContain("already proposes");
  });

  it("detects duplicate provisions when active bills still use a legacy legislation type id", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            {
              legislationTypeId: "us_federal_corporate_tax_rate",
              policyOptionId: "federal_corporate_tax_rate_opt_0",
              effectDirection: 0,
            },
          ],
        },
      ]),
    });
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "us_federal_domestic_corporate_tax_rate",
      name: "Federal Domestic Corporate Tax Rate",
    });

    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "US", status: { $nin: ["failed"] } },
      [
        {
          legislationTypeId: "us_federal_domestic_corporate_tax_rate",
          policyOptionId: "federal_corporate_tax_rate_opt_0",
        },
      ]
    );
    expect(result).not.toBeNull();
    expect(result!.error).toContain("Federal Domestic Corporate Tax Rate");
  });

  it("allows different policy option levels for same legislation type", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            { legislationTypeId: "income_tax", policyOptionId: "opt_3", effectDirection: 0 },
          ],
        },
      ]),
    });

    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "US", status: { $nin: ["failed"] } },
      [{ legislationTypeId: "income_tax", policyOptionId: "opt_5" }]
    );
    expect(result).toBeNull();
  });

  it("skips tariff and subsidy provisions in active bills", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            { type: "tariff", scopeType: "economy_wide", rate: 10 },
            { type: "subsidy", scopeType: "sector", domesticOnly: false },
            { type: "end_subsidy", scopeType: "economy_wide" },
          ],
        },
      ]),
    });

    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "US", status: { $nin: ["failed"] } },
      [{ legislationTypeId: "income_tax", policyOptionId: "opt_3" }]
    );
    expect(result).toBeNull();
  });
});

describe("checkCurrentPolicyLevel", () => {
  async function loadHelper() {
    const { checkCurrentPolicyLevel } = await import("./billProposalLimits");
    return checkCurrentPolicyLevel;
  }

  it("returns null when no provisions have policyOptionId", async () => {
    const check = await loadHelper();
    const result = await check(db as unknown as Db, "federal", [
      { legislationTypeId: "income_tax" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null when proposed level differs from current", async () => {
    const check = await loadHelper();
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ legislationTypeId: "income_tax", policyOptionId: "opt_5" }]),
    });

    const result = await check(db as unknown as Db, "federal", [
      { legislationTypeId: "income_tax", policyOptionId: "opt_3" },
    ]);
    expect(result).toBeNull();
  });

  it("detects proposing the current active level", async () => {
    const check = await loadHelper();
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ legislationTypeId: "income_tax", policyOptionId: "opt_5" }]),
    });
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "income_tax",
      name: "Income Tax",
    });

    const result = await check(db as unknown as Db, "federal", [
      { legislationTypeId: "income_tax", policyOptionId: "opt_5" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.error).toContain("Income Tax");
    expect(result!.error).toContain("already at this level");
  });

  it("detects the current policy level when statePolicies still store a legacy legislation type id", async () => {
    const check = await loadHelper();
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          legislationTypeId: "us_federal_corporate_tax_rate",
          policyOptionId: "federal_corporate_tax_rate_opt_0",
        },
      ]),
    });
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: "us_federal_domestic_corporate_tax_rate",
      name: "Federal Domestic Corporate Tax Rate",
    });

    const result = await check(db as unknown as Db, "federal", [
      {
        legislationTypeId: "us_federal_domestic_corporate_tax_rate",
        policyOptionId: "federal_corporate_tax_rate_opt_0",
      },
    ]);
    expect(result).not.toBeNull();
    expect(result!.error).toContain("Federal Domestic Corporate Tax Rate");
    expect(result!.error).toContain("already at this level");
  });

  it("treats a region's missing row for a new-generation `both` law as level 0", async () => {
    // The propose modal disables the level-0 option (current-policies now
    // reports 0 for these), so the API must agree — otherwise a direct caller
    // files a no-op bill the UI already refuses to build.
    const check = await loadHelper();
    const bothLaw = getCatalog("RU").find(
      (law) => law.kind !== "tax" && law.allowedScope === "both"
    )!;
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("enactedLaws");
    db.collectionMocks.enactedLaws.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    // The stored doc IS the projection, so the level-0 option is `l0`.
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([projectLawToLegislationType(bothLaw)]),
    });
    db.collectionMocks.legislationTypes.findOne.mockResolvedValue({
      _id: bothLaw.id,
      name: bothLaw.title,
    });

    const result = await check(db as unknown as Db, "MOW", [
      { legislationTypeId: bothLaw.id, policyOptionId: "l0" },
    ]);
    expect(result).not.toBeNull();
    expect(result!.error).toContain("already at this level");
  });

  it("still allows proposing a level above the region default", async () => {
    const check = await loadHelper();
    const bothLaw = getCatalog("RU").find(
      (law) => law.kind !== "tax" && law.allowedScope === "both"
    )!;
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("enactedLaws");
    db.collectionMocks.enactedLaws.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });

    const result = await check(db as unknown as Db, "MOW", [
      { legislationTypeId: bothLaw.id, policyOptionId: "l3" },
    ]);
    expect(result).toBeNull();
  });

  it("does not apply the region default at national scope", async () => {
    // National rows are seeded; a missing one is a different problem and must
    // not start refusing level-0 proposals.
    const check = await loadHelper();
    const bothLaw = getCatalog("RU").find(
      (law) => law.kind !== "tax" && law.allowedScope === "both"
    )!;
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("enactedLaws");
    db.collectionMocks.enactedLaws.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });

    const result = await check(db as unknown as Db, "su_national", [
      { legislationTypeId: bothLaw.id, policyOptionId: "l0" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null when no current policy exists for legislation type", async () => {
    const check = await loadHelper();
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const result = await check(db as unknown as Db, "federal", [
      { legislationTypeId: "new_policy_type", policyOptionId: "opt_1" },
    ]);
    expect(result).toBeNull();
  });
});

describe("checkDuplicateTariffProvisions", () => {
  async function loadHelper() {
    const { checkDuplicateTariffProvisions } = await import("./billProposalLimits");
    return checkDuplicateTariffProvisions;
  }

  it("returns null when proposed tariff list is empty", async () => {
    const check = await loadHelper();
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "UK", status: { $nin: ["failed"] } },
      []
    );
    expect(result).toBeNull();
  });

  it("returns null when no active bills exist", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "UK", status: { $nin: ["failed"] } },
      [{ scopeType: "economy_wide" }]
    );
    expect(result).toBeNull();
  });

  it("detects duplicate origin_country tariff at same target", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            { type: "tariff", scopeType: "origin_country", targetOriginCountryId: "US", rate: 15 },
          ],
        },
      ]),
    });
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "UK", status: { $nin: ["failed"] } },
      [{ scopeType: "origin_country", targetOriginCountryId: "US" }]
    );
    expect(result).not.toBeNull();
    expect(result?.error).toMatch(/already proposes a tariff/i);
  });

  it("detects duplicate sector-scope tariff at same sector", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            { type: "tariff", scopeType: "sector", targetSectorType: "automobiles", rate: 10 },
          ],
        },
      ]),
    });
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "UK", status: { $nin: ["failed"] } },
      [{ scopeType: "sector", targetSectorType: "automobiles" }]
    );
    expect(result).not.toBeNull();
  });

  it("allows different sector targets to coexist", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            { type: "tariff", scopeType: "sector", targetSectorType: "automobiles", rate: 10 },
          ],
        },
      ]),
    });
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "UK", status: { $nin: ["failed"] } },
      [{ scopeType: "sector", targetSectorType: "technology" }]
    );
    expect(result).toBeNull();
  });

  it("allows economy_wide to coexist with sector-specific", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [
            { type: "tariff", scopeType: "sector", targetSectorType: "automobiles", rate: 10 },
          ],
        },
      ]),
    });
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "UK", status: { $nin: ["failed"] } },
      [{ scopeType: "economy_wide" }]
    );
    expect(result).toBeNull();
  });

  it("ignores non-tariff provisions in active bills", async () => {
    const check = await loadHelper();
    db.collectionMocks.bills.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          provisions: [{ legislationTypeId: "income_tax", policyOptionId: "opt_1" }],
        },
      ]),
    });
    const result = await check(
      db as unknown as Db,
      "bills",
      { countryId: "UK", status: { $nin: ["failed"] } },
      [{ scopeType: "economy_wide" }]
    );
    expect(result).toBeNull();
  });
});
