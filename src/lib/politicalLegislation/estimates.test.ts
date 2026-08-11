import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { UK_LAWS } from "./laws/ukLaws";
import { attachPoliticalLegislationEstimates } from "./estimates";
import { projectLawToLegislationType } from "./project";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("attachPoliticalLegislationEstimates", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    for (const name of ["states", "federalBudget"]) db.collection(name);
    db.collectionMocks.states.find = vi.fn().mockImplementation(() => ({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "uk1", countryId: "UK", gdp: 19_800, population: 52_600_000 }]),
    }));
    db.collectionMocks.federalBudget.findOne = vi.fn().mockResolvedValue({
      taxRates: { payrollTax: 7.2 },
      taxBases: { wagesAndSalaries: 7_200_000_000 },
    });
  });

  it("attaches per-level estimates to program laws on the rollup base", async () => {
    const nhs = projectLawToLegislationType(
      UK_LAWS.find((l) => l.id === "uk.health.universalCare.primary")!
    );
    const [doc] = await attachPoliticalLegislationEstimates(
      db as unknown as Db,
      [nhs as unknown as Record<string, unknown>],
      "uk",
      null,
      null
    );
    const estimates = doc.estimates as Array<{ level: number; cost: number; net: number }>;
    expect(estimates).toHaveLength(5);
    expect(estimates[0].cost).toBe(0);
    expect(estimates[4].cost).toBeGreaterThan(425_000_000);
    expect(estimates[4].net).toBeLessThan(0);
  });

  it("attaches the live current rate and per-point revenue delta to sliders", async () => {
    const ni = projectLawToLegislationType(UK_LAWS.find((l) => l.id === "uk.tax.payrollTax")!);
    const [doc] = await attachPoliticalLegislationEstimates(
      db as unknown as Db,
      [ni as unknown as Record<string, unknown>],
      "uk",
      null,
      null
    );
    const slider = doc.taxSliderEstimate as { currentRate: number; revenueDeltaPerPoint: number };
    expect(slider.currentRate).toBe(7.2);
    expect(slider.revenueDeltaPerPoint).toBe(72_000_000);
  });

  it("passes legacy docs and legacy countries through untouched", async () => {
    const legacy = { _id: "jp_old_law", policyOptions: [{ id: "a" }] };
    const sameDocs = await attachPoliticalLegislationEstimates(
      db as unknown as Db,
      [legacy],
      "jp",
      null,
      null
    );
    expect(sameDocs[0]).toBe(legacy);
    const ukLegacy = await attachPoliticalLegislationEstimates(
      db as unknown as Db,
      [legacy],
      "uk",
      null,
      null
    );
    expect(ukLegacy[0].estimates).toBeUndefined();
  });
});
