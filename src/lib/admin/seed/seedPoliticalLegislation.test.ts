import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkOps, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getAllNewGenerationLawIds, getCatalog } from "@/lib/politicalLegislation/catalog";
import { lawTargets } from "@/lib/politicalLegislation/dynamics";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import {
  baselineEnactedLawId,
  getProjectedPoliticalLegislationTypes,
  seedPoliticalLegislationBaseline,
} from "./seedPoliticalLegislation";
import { seedLegislationTypes } from "./seedLegislationTypes";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/budget/revenue", () => ({
  refreshNationalBudgetRevenue: vi.fn().mockResolvedValue(3),
}));

describe("getProjectedPoliticalLegislationTypes", () => {
  it("projects all core + regional sidecar laws with unique ids", () => {
    const docs = getProjectedPoliticalLegislationTypes();
    // 436 core + 6 DD Land regional sidecars + 5 US state tax sliders
    expect(docs.length).toBe(447);
    expect(new Set(docs.map((d) => d._id)).size).toBe(447);
    expect(docs.some((d) => d._id === "dd.sec.landPolytechnicEducation")).toBe(true);
    expect(docs.find((d) => d._id === "dd.sec.landPolytechnicEducation")?.allowedScope).toBe(
      "state"
    );
    expect(docs.some((d) => d._id === "us.tax.stateIncomeTax")).toBe(true);
    expect(docs.find((d) => d._id === "us.tax.stateIncomeTax")?.allowedScope).toBe("state");
  });
});

describe("baselineEnactedLawId", () => {
  it("is deterministic and collision-free across every program law", () => {
    const ids = LAW_COUNTRY_IDS.flatMap((cc) =>
      getCatalog(cc)
        .filter((l) => l.kind !== "tax")
        .map((l) => baselineEnactedLawId(l.id).toHexString())
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(baselineEnactedLawId("uk.health.universalCare.primary").toHexString()).toBe(
      baselineEnactedLawId("uk.health.universalCare.primary").toHexString()
    );
  });
});

describe("seedLegislationTypes — exclusion sweep + generation-aware deleter", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function bulkWrittenIds(): string[] {
    const calls = (db.collectionMocks.legislationTypes.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls;
    return calls.flatMap((call) =>
      (call[0] as Array<{ replaceOne: { filter: { _id: string } } }>).map(
        (op) => op.replaceOne.filter._id
      )
    );
  }

  it("seeds projected new-generation docs instead of old US/UK/RU/DD catalogs on the 1953 preset", async () => {
    await seedLegislationTypes(db as unknown as Db, false, vi.fn(), "1953-default");
    const ids = bulkWrittenIds();
    expect(ids).toContain("uk.health.universalCare.primary");
    expect(ids).toContain("ru.tax.salesTax");
    expect(ids.some((id) => id.startsWith("us_"))).toBe(false);
    expect(ids.some((id) => id.startsWith("uk_"))).toBe(false);
    expect(ids.some((id) => id.startsWith("su_"))).toBe(false);
    // The prune keeps the seeded set (incl. every projected id) as valid.
    const deleteCall = (
      db.collectionMocks.legislationTypes.deleteMany as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)![0] as { _id: { $nin: string[] } };
    for (const id of getAllNewGenerationLawIds()) {
      expect(deleteCall._id.$nin).toContain(id);
    }
  });

  it("seeds the new-generation catalogs on non-1953 presets too — the pipeline is year-driven", async () => {
    await seedLegislationTypes(db as unknown as Db, false, vi.fn(), "2019-default");
    const ids = bulkWrittenIds();
    // Playable countries are on the new-generation book at EVERY preset; their
    // old catalogs are excluded everywhere. Leaving them preset-gated is what
    // produced the split state where a non-1953 world ran political metrics
    // alongside the old stateMetrics-targeting legislation.
    expect(ids).toContain("uk.health.universalCare.primary");
    expect(ids.some((id) => id.startsWith("us_"))).toBe(false);
    expect(ids.some((id) => id.startsWith("uk_"))).toBe(false);
    expect(ids.some((id) => id.startsWith("su_"))).toBe(false);
    // Non-playable catalogs are untouched by any of this.
    expect(ids.some((id) => id.startsWith("jp_"))).toBe(true);
  });
});

describe("seedPoliticalLegislationBaseline", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    // countryFiscalBase reads states: give each country one region. DD gets the
    // six authored Länder so the Land sidecar baseline is exercised.
    db.collectionMocks.states = {
      ...db.collectionMocks.states,
      find: vi.fn().mockImplementation((filter?: { countryId?: string }) => ({
        toArray: vi.fn().mockResolvedValue(
          filter?.countryId === "DD"
            ? ["BEO", "MV", "BB", "ST", "SN", "TH"].map((id) => ({
                _id: id,
                countryId: "DD",
                gdp: 3_300,
                population: 2_900_000,
              }))
            : [
                {
                  _id: `${filter?.countryId}-1`,
                  countryId: filter?.countryId,
                  gdp: 19_800,
                  population: 52_600_000,
                },
              ]
        ),
      })),
    } as typeof db.collectionMocks.states;
  });

  it("seeds one policy record per program law and enacted laws above level 0", async () => {
    await seedPoliticalLegislationBaseline(db as unknown as Db, vi.fn(), 1953);
    const policyUpserts = bulkOps(db.collectionMocks.statePolicies.bulkWrite);
    // 103 national program laws × 4 countries + 6 DD Land laws × 6 Länder.
    expect(policyUpserts.length).toBe(412 + 36);
    const landScoped = policyUpserts.filter((c) => (c[0] as { scope?: string }).scope === "state");
    expect(landScoped.length).toBe(36);
    const lawReplaces = bulkOps(db.collectionMocks.enactedLaws.bulkWrite);
    const expectedEnacted = LAW_COUNTRY_IDS.flatMap((cc) =>
      getCatalog(cc).filter(
        (l) => l.kind !== "tax" && l.allowedScope !== "regional" && (l.baselineLevel ?? 0) > 0
      )
    ).length;
    expect(lawReplaces.length).toBe(expectedEnacted);
    // Every enacted record carries the nested v2 model and an explicit option index.
    for (const call of lawReplaces) {
      const doc = call[1] as { costModelV2?: unknown; policyOptionIndex?: number };
      expect(doc.costModelV2).toBeDefined();
      expect(doc.policyOptionIndex).toBeGreaterThan(0);
    }
  });

  it("seeds no statePolicies for tax laws and runs the budget sync once", async () => {
    const { refreshNationalBudgetRevenue } = await import("@/lib/budget/revenue");
    await seedPoliticalLegislationBaseline(db as unknown as Db, vi.fn(), 1953);
    const policyIds = bulkOps(db.collectionMocks.statePolicies.bulkWrite).map(
      (c) => (c[0] as { legislationTypeId: string }).legislationTypeId
    );
    expect(policyIds.some((id) => id.includes(".tax."))).toBe(false);
    expect(refreshNationalBudgetRevenue).toHaveBeenCalledWith(expect.anything(), [
      "federal", // US budget _id (getNationalBudgetId) — not "US"
      "UK",
      "RU",
      "DD",
    ]);
  });
});

describe("seedPoliticalMetricsResiduals (§4)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collectionMocks.states = {
      ...db.collectionMocks.states,
      find: vi.fn().mockImplementation((filter?: { countryId?: string }) => ({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: `${filter?.countryId}-1`,
            countryId: filter?.countryId,
            gdp: 19_800,
            population: 52_600_000,
          },
        ]),
      })),
    } as typeof db.collectionMocks.states;
    db.collection("politicalMetrics");
    db.collectionMocks.politicalMetrics.find = vi
      .fn()
      .mockImplementation((filter?: { countryId?: string }) => ({
        toArray: vi
          .fn()
          .mockResolvedValue(
            filter?.countryId === "UK"
              ? [{ _id: "R1", countryId: "UK", values: { "health.universalCare": 74 } }]
              : []
          ),
      }));
  });

  it("persists residual = seed − dayOneTarget so every region starts at equilibrium", async () => {
    await seedPoliticalLegislationBaseline(db as unknown as Db, vi.fn(), 1953);
    const writes = bulkOps(db.collectionMocks.politicalMetrics.bulkWrite);
    const ukWrite = writes.find((c) => (c[0] as { _id: string })._id === "R1")!;
    const residuals = (ukWrite[1] as { $set: { residuals: Record<string, number> } }).$set
      .residuals;
    const levels = new Map(
      getCatalog("UK")
        .filter((l) => l.kind !== "tax")
        .map((l) => [l.id, l.baselineLevel ?? 0])
    );
    expect(residuals["health.universalCare"]).toBeCloseTo(
      74 - lawTargets("UK", levels)["health.universalCare"],
      9
    );
    // Unvalued metrics residual against 0 (value ?? 0 − points).
    expect(residuals["economy.workerSecurity"]).toBeCloseTo(
      0 - lawTargets("UK", levels)["economy.workerSecurity"],
      9
    );
  });
});
