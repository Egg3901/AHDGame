import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { LegislationType } from "@/lib/db/types/legislation";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { programCostScaleForLaw } from "@/lib/politicalLegislation/programCostScale";
import { checkEconomicOpening } from "../seedDiagnostic/economicOpening";
import { seedNppCorporations } from "./seedNppCorporations";

let db: Db;
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => db),
  getMongoClient: vi.fn(async () => ({ db: () => ({ command: async () => ({}) }) })),
}));

beforeAll(async () => {
  const { createInMemoryDb } = await import("@/lib/test-utils/inMemoryDb");
  db = createInMemoryDb() as unknown as Db;
  const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");
  const log: string[] = [];
  await bootstrapGameWorld({
    db,
    preset: "1991-default",
    resetReference: true,
    log: (line) => log.push(line),
    fresh1991VehicleModelSeed: true,
    fresh1991MediaTaxonomySeed: true,
  });
  expect(log.filter((line) => /\bfailed\b|^error:/i.test(line))).toEqual([]);
}, 600_000);

describe("1991 reset economic acceptance", () => {
  it("qualifies the actual seeded fiscal, currency, competitor, credit and background documents", async () => {
    const checks = await checkEconomicOpening(db, "1991-default");
    const failures = checks.filter((row) => row.severity !== "ok");
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(checks.length).toBeGreaterThan(100);
  });

  it("preserves affordable fiscal openings after a real runtime budget refresh", async () => {
    const { refreshNationalBudgetRevenue } = await import("@/lib/budget/revenue");
    await refreshNationalBudgetRevenue(db, ["federal", "UK", "JP"]);
    const fiscal = await db
      .collection("federalBudget")
      .find({ countryId: { $in: ["US", "UK", "JP"] } })
      .toArray();
    console.info(
      "Opening fiscal evidence",
      JSON.stringify(
        fiscal.map((budget) => ({
          country: budget.countryId,
          currency: budget.currencyCode,
          debt: budget.debt.principal,
          receipts: budget.revenue.total,
          expenses: budget.spending.total,
          deficitGdpPercent: (-100 * budget.surplus) / budget.gdp,
          programScale: budget.programCostScaleBaseline ?? 1,
        }))
      )
    );
    const checks = await checkEconomicOpening(db, "1991-default");
    const failures = checks.filter(
      (row) =>
        ["US", "UK", "JP"].includes(row.scope) &&
        ["fiscal-accounting", "opening-deficit", "debt-instruments"].includes(row.metric) &&
        row.severity !== "ok"
    );
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  }, 30_000);

  it("fits the US program book to its authored 1991 composition through repeated refreshes", async () => {
    const { refreshNationalBudgetRevenue } = await import("@/lib/budget/revenue");
    const { calculateFederalLawAnnualCosts } = await import("@/lib/budget/spending");
    const { getAuthoredNationalSpending1991 } = await import("@/lib/seeds/reference/budgets");
    const authored = getAuthoredNationalSpending1991("US")!;
    const authoredTotal = Object.values(authored).reduce((a, b) => a + b, 0);
    for (let refresh = 0; refresh < 3; refresh++) {
      await refreshNationalBudgetRevenue(db, ["federal"]);
      const budget = (await db.collection<FederalBudget>("federalBudget").findOne({
        _id: "federal",
      }))!;
      expect(Math.abs(budget.surplus / budget.gdp + 0.005)).toBeLessThan(0.0005);
      const { items } = await calculateFederalLawAnnualCosts(db, budget);
      const byCategory: Record<string, number> = {};
      for (const { law, amount } of items) {
        if (!law.costModelV2) continue;
        byCategory[law.budgetCategory || "other"] =
          (byCategory[law.budgetCategory || "other"] ?? 0) + amount;
      }
      const programTotal = Object.values(byCategory).reduce((a, b) => a + b, 0);
      for (const [category, amount] of Object.entries(authored)) {
        expect((byCategory[category] ?? 0) / programTotal, category).toBeCloseTo(
          amount / authoredTotal,
          6
        );
      }
      // The 1953 book-wide fit left defence at 8.5% of GDP and health at 0.3%.
      expect(byCategory.defense! / budget.gdp).toBeLessThan(0.05);
      expect(byCategory.healthcare! / budget.gdp).toBeGreaterThan(0.01);
    }

    // Enacted programs and later bills price on the same per-category scale.
    const budget = (await db.collection<FederalBudget>("federalBudget").findOne({
      _id: "federal",
    }))!;
    const { items } = await calculateFederalLawAnnualCosts(db, budget);
    const types = new Map(
      (
        await db
          .collection<LegislationType>("legislationTypes")
          .find({ _id: { $in: items.map(({ law }) => law.legislationTypeId) } })
          .toArray()
      ).map((type) => [type._id, type])
    );
    let compared = 0;
    for (const { law } of items) {
      if (!law.costModelV2) continue;
      const option = types.get(law.legislationTypeId)?.policyOptions?.[law.policyOptionIndex ?? -1];
      expect(option?.costModelV2, law.legislationTypeId).toEqual(law.costModelV2);
      const catalogLaw = getLaw(law.legislationTypeId)!;
      const quote = programCostScaleForLaw(budget, catalogLaw);
      const scale = budget.programCostScaleByCategoryBaseline?.[law.budgetCategory || "other"];
      expect(quote, law.legislationTypeId).toBe(scale);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  }, 60_000);

  it("refills a missing competitor without skipping or duplicating the rest of its country", async () => {
    const before = await db.collection("corporations").countDocuments({ ceoType: "npp" });
    for (const market of [
      { type: "retail" },
      { type: "manufacturing", industryModel: "vehicles" },
      { type: "media", mediaDiscriminator: "entertainment" },
    ]) {
      const missing = await db
        .collection("corporations")
        .findOne({ countryId: "US", ceoType: "npp", ...market });
      expect(missing).not.toBeNull();
      await db.collection("corporations").deleteOne({ _id: missing!._id });
      await db.collection("corporateSectors").deleteMany({ corporationId: missing!._id });
    }
    expect((await seedNppCorporations(db, "1991-default", 1991, () => {})).totalSpawned).toBe(3);
    expect(await db.collection("corporations").countDocuments({ ceoType: "npp" })).toBe(before);
    expect((await seedNppCorporations(db, "1991-default", 1991, () => {})).totalSpawned).toBe(0);
    expect(
      (await checkEconomicOpening(db, "1991-default")).filter((row) => row.severity !== "ok")
    ).toEqual([]);
  }, 30_000);

  it("detects a non-finite FX row and missing background data rather than passing presence alone", async () => {
    await db
      .collection("exchangeRates")
      .updateOne({ countryId: "PL" }, { $set: { rate: Number.NaN } });
    const macro = await db.collection("macroCountries").findOne({});
    expect(macro).not.toBeNull();
    await db.collection("macroCountries").deleteOne({ _id: macro!._id });
    const checks = await checkEconomicOpening(db, "1991-default");
    expect(checks.find((row) => row.id === "opening.PL.currency")?.severity).toBe("critical");
    expect(
      checks.some(
        (row) =>
          row.scope === macro!.entityId &&
          row.metric === "aggregate-economy" &&
          row.severity === "critical"
      )
    ).toBe(true);
  });
});
