import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Bill } from "@/lib/db/types";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(5) }));
vi.mock("@/lib/nationalization/nationalCorporation", () => ({
  isStateOwned: (c: { countryOwnerId?: string }) => !!c?.countryOwnerId,
}));
// billEnrichment delegates the affected-corp/treasury-cost computation to this
// shared helper; each test sets the return it wants. The helper's own logic
// (sector vs corp vs already-state-owned) is covered in billTargetPreview.test.ts.
vi.mock("@/lib/nationalization/billTargetPreview", () => ({
  computeNationalizationProvisionDetail: vi.fn().mockResolvedValue(undefined),
}));
// Actual payout is read from the permanent ledger; mock it here.
vi.mock("@/lib/nationalization/ledger", () => ({
  resolveActualPayoutLocal: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("legislationTypes");
  db.collection("statePolicies");
  db.collection("enactedLaws");
  db.collection("corporations");
  db.collectionMocks.legislationTypes.find.mockReturnValue({ toArray: async () => [] });
  db.collectionMocks.statePolicies.find.mockReturnValue({ toArray: async () => [] });
});

describe("resolveBillProvisions", () => {
  it("resolves legacy legislation type ids against canonical legislation types and current policies", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");

    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "us_federal_domestic_corporate_tax_rate",
          name: "Federal Domestic Corporate Tax Rate",
          effectTarget: { metricId: "corporateTaxRate" },
          policyOptions: [
            {
              id: "federal_corporate_tax_rate_opt_0",
              name: "0%",
              explanation: "0%: Far Right econ",
              effectDirection: 0,
              economic: 3,
              social: 0,
            },
            {
              id: "federal_corporate_tax_rate_opt_5",
              name: "20%",
              explanation: "20%: Center-Left econ",
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
          stateId: "federal",
          legislationTypeId: "us_federal_corporate_tax_rate",
          policyOptionId: "federal_corporate_tax_rate_opt_0",
          policyOptionIndex: 0,
        },
      ],
    });

    const bill = {
      countryId: "US",
      stateId: "federal",
      provisions: [
        {
          legislationTypeId: "us_federal_corporate_tax_rate",
          policyOptionId: "federal_corporate_tax_rate_opt_5",
          effectDirection: 0,
          economic: -1,
          social: 0,
        },
      ],
    } as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved).toHaveLength(1);
    expect(result.provisionsResolved[0]).toMatchObject({
      legislationTypeName: "Federal Domestic Corporate Tax Rate",
      policyOptionName: "20%: Center-Left econ",
      currentPolicyOptionName: "0%: Far Right econ",
      changeDirection: "up",
    });
  });

  it("renders readable labels for tariff provisions", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");

    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [],
    });
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: async () => [],
    });

    const bill = {
      countryId: "US",
      stateId: "federal",
      provisions: [
        {
          type: "tariff",
          scopeType: "origin_country",
          targetOriginCountryId: "JP",
          rate: 40,
        },
      ],
    } as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved).toHaveLength(1);
    expect(result.provisionsResolved[0]).toMatchObject({
      legislationTypeName: "Tariff",
      policyOptionName: "40% tariff on imports from Japan",
    });
  });

  it("reports projected effects as a per-metric delta vs the current law, honoring weight sign + isHigherBetter", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");

    // CN "Statutory State Enterprises Law": industrialPolicyExecution is positively
    // weighted, gdpGrowth is negatively weighted. Proposing the most statist option
    // (Full State Ownership, effectDirection +1) over the most market option currently
    // active (SOE Liberalization, effectDirection -1) raises industrial-policy execution
    // but lowers GDP growth — the chips must reflect each metric individually, NOT a
    // single option-level direction.
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "cn_state_enterprises",
          name: "Statutory State Enterprises Law",
          effectTargetsWeighted: [
            { metricCategoryId: "economic", metricId: "industrialPolicyExecution", weight: 0.7 },
            { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
          ],
          policyOptions: [
            {
              id: "cn_state_enterprises_opt_0",
              name: "Full State Ownership Law",
              effectDirection: 1,
              economic: -5,
              social: 2,
            },
            {
              id: "cn_state_enterprises_opt_1",
              name: "SOE Liberalization Law",
              effectDirection: -1,
              economic: 3,
              social: -1,
            },
          ],
        },
      ],
    });
    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: async () => [
        {
          stateId: "cn_national",
          legislationTypeId: "cn_state_enterprises",
          policyOptionId: "cn_state_enterprises_opt_1",
          policyOptionIndex: 1,
        },
      ],
    });

    const bill = {
      countryId: "CN",
      stateId: "cn_national",
      provisions: [
        {
          legislationTypeId: "cn_state_enterprises",
          policyOptionId: "cn_state_enterprises_opt_0",
          effectDirection: 1,
          economic: -5,
          social: 2,
        },
      ],
    } as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved[0].effects).toEqual(
      expect.arrayContaining([
        { metric: "Industrial Policy Execution", direction: "up", isGood: true },
        { metric: "Gdp Growth", direction: "down", isGood: false },
      ])
    );
  });

  it("prefers snapshotted provision labels over live policy after the law changes", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");

    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: "family_policy",
          name: "Family Policy",
          policyOptions: [
            {
              id: "family_current",
              name: "Current Law",
              explanation: "Current Law: Live value after enactment",
              effectDirection: 0,
              economic: 0,
              social: 0,
            },
            {
              id: "family_proposed",
              name: "Proposed Law",
              explanation: "Proposed Law: Historical proposal text",
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
          policyOptionId: "family_proposed",
          policyOptionIndex: 1,
        },
      ],
    });

    const bill = {
      countryId: "JP",
      stateId: "jp_national",
      provisions: [
        {
          legislationTypeId: "family_policy",
          policyOptionId: "family_proposed",
          policyOptionNameSnapshot: "Supporting Families Act: Historical proposal text",
          currentPolicyOptionIdSnapshot: "family_current",
          currentPolicyOptionNameSnapshot: "Status Quo Law: Historical current text",
          effectDirection: 0,
          economic: -1,
          social: 0,
        },
      ],
    } as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved[0]).toMatchObject({
      policyOptionName: "Supporting Families Act: Historical proposal text",
      currentPolicyOptionName: "Status Quo Law: Historical current text",
      changeDirection: "up",
    });
  });

  it("attaches the affected-corp/payout preview to an industry-wide sector nationalize provision", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");
    const { computeNationalizationProvisionDetail } =
      await import("@/lib/nationalization/billTargetPreview");
    vi.mocked(computeNationalizationProvisionDetail).mockResolvedValueOnce({
      kind: "sector",
      sector: {
        affectedCount: 1,
        totalCompensationLocal: 2000,
        unownedSliceRevenuePerTurn: 500,
      },
    } as never);

    const bill = {
      countryId: "CN",
      stateId: "cn_national",
      provisions: [
        {
          type: "nationalize",
          targetSectorType: "technology",
          sectorCarveFraction: 1,
          sectorScope: "all",
        },
      ],
    } as unknown as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved[0]).toMatchObject({
      legislationTypeName: "Nationalization",
      policyOptionName: "Sector takeover — Technology · 100% · All holders + unowned market",
      nationalizationDetail: {
        kind: "sector",
        sector: { affectedCount: 1, totalCompensationLocal: 2000, unownedSliceRevenuePerTurn: 500 },
      },
    });
  });

  it("attaches the target-corp detail to a whole-corp nationalize provision", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");
    const { computeNationalizationProvisionDetail } =
      await import("@/lib/nationalization/billTargetPreview");
    vi.mocked(computeNationalizationProvisionDetail).mockResolvedValueOnce({
      kind: "corp",
      corp: { name: "Zhongtian", ownerKind: "player", triggers: ["strategic"] },
    } as never);
    const corpId = new ObjectId();

    const bill = {
      countryId: "CN",
      stateId: "cn_national",
      provisions: [{ type: "nationalize", targetCorporationId: corpId }],
    } as unknown as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved[0]).toMatchObject({
      legislationTypeName: "Nationalization",
      policyOptionName: "Whole-corporation takeover",
      nationalizationDetail: {
        kind: "corp",
        corp: { name: "Zhongtian", ownerKind: "player", triggers: ["strategic"] },
      },
    });
  });

  it("attaches no detail when the helper returns undefined (e.g. already-state-owned target)", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");
    const { computeNationalizationProvisionDetail } =
      await import("@/lib/nationalization/billTargetPreview");
    vi.mocked(computeNationalizationProvisionDetail).mockResolvedValueOnce(undefined);
    const corpId = new ObjectId();

    const bill = {
      countryId: "CN",
      stateId: "cn_national",
      provisions: [{ type: "nationalize", targetCorporationId: corpId }],
    } as unknown as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);
    expect(result.provisionsResolved[0].nationalizationDetail).toBeUndefined();
  });

  it("overlays the actual payout from the ledger onto an enacted nationalize provision", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");
    const { computeNationalizationProvisionDetail } =
      await import("@/lib/nationalization/billTargetPreview");
    const { resolveActualPayoutLocal } = await import("@/lib/nationalization/ledger");
    vi.mocked(computeNationalizationProvisionDetail).mockResolvedValueOnce({
      kind: "sector",
      sector: { affectedCount: 1, totalCompensationLocal: 2000, unownedSliceRevenuePerTurn: 500 },
    } as never);
    vi.mocked(resolveActualPayoutLocal).mockResolvedValueOnce(1134);

    const bill = {
      countryId: "CN",
      stateId: "cn_national",
      provisions: [
        {
          type: "nationalize",
          targetSectorType: "energy",
          sectorCarveFraction: 1,
          sectorScope: "all",
        },
      ],
    } as unknown as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved[0].nationalizationDetail).toMatchObject({
      kind: "sector",
      actualPayoutLocal: 1134,
    });
  });

  it("uses the frozen snapshot for an enacted bill instead of recomputing live", async () => {
    const { resolveBillProvisions } = await import("./billEnrichment");
    const { computeNationalizationProvisionDetail } =
      await import("@/lib/nationalization/billTargetPreview");
    const frozen = {
      kind: "sector" as const,
      sector: { affectedCount: 3, totalCompensationLocal: 999, unownedSliceRevenuePerTurn: 12 },
    };

    const bill = {
      countryId: "CN",
      stateId: "cn_national",
      provisions: [
        {
          type: "nationalize",
          targetSectorType: "energy",
          sectorCarveFraction: 1,
          sectorScope: "all",
          nationalizationSnapshot: frozen,
        },
      ],
    } as unknown as Bill;

    const result = await resolveBillProvisions(db as unknown as Db, bill);

    expect(result.provisionsResolved[0].nationalizationDetail).toEqual(frozen);
    // The frozen snapshot wins — no live recompute for an enacted bill.
    expect(vi.mocked(computeNationalizationProvisionDetail)).not.toHaveBeenCalled();
  });
});
