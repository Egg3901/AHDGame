/**
 * Issue 3327 qualification: bootstrap an isolated in-memory 1991 world from
 * this checkout and report the US program composition against the authored
 * FY1991 budget, after seed and after repeated runtime budget refreshes. The
 * UK and JP openings are compared with the checked-in issue 3292 report to
 * show they are unchanged. No live or sandbox database is touched.
 *
 *   AHD_SIM_REPORT=1 npx vitest run scripts/sim/usOpeningComposition1991.test.ts
 *
 * Skipped without AHD_SIM_REPORT; resetEconomicOpening.integration.test.ts
 * carries the US composition gate in the default suite.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";

let db: Db;
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => db),
  getMongoClient: vi.fn(async () => ({ db: () => ({ command: async () => ({}) }) })),
}));

const PLAYERS = ["US", "UK", "JP"] as const;
const BASELINE = "scripts/sim/ukOpeningFiscal1991.report.json";

type Row = {
  country: string;
  revenue: number;
  spending: number;
  balanceGdpPercent: number;
  categoryGdpPercent: Record<string, number>;
  programShare?: Record<string, number>;
};

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

async function snapshot(): Promise<Row[]> {
  const { calculateFederalLawAnnualCosts } = await import("@/lib/budget/spending");
  const budgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
  const rows: Row[] = [];
  for (const budget of budgets) {
    if (!(PLAYERS as readonly string[]).includes(budget.countryId!)) continue;
    const row: Row = {
      country: budget.countryId!,
      revenue: budget.revenue.total,
      spending: budget.spending.total,
      balanceGdpPercent: (100 * budget.surplus) / budget.gdp,
      categoryGdpPercent: Object.fromEntries(
        Object.entries(budget.spending.byCategory).map(([category, amount]) => [
          category,
          round((100 * amount) / budget.gdp, 2),
        ])
      ),
    };
    if (budget.countryId === "US") {
      const { items } = await calculateFederalLawAnnualCosts(db, budget);
      const byCategory: Record<string, number> = {};
      for (const { law, amount } of items) {
        if (!law.costModelV2) continue;
        const category = law.budgetCategory || "other";
        byCategory[category] = (byCategory[category] ?? 0) + amount;
      }
      const total = Object.values(byCategory).reduce((a, b) => a + b, 0);
      row.programShare = Object.fromEntries(
        Object.entries(byCategory).map(([category, amount]) => [category, round(amount / total, 4)])
      );
    }
    rows.push(row);
  }
  return rows.sort((a, b) => a.country.localeCompare(b.country));
}

describe.runIf(process.env.AHD_SIM_REPORT === "1")(
  "1991 US program composition (issue 3327)",
  () => {
    beforeAll(async () => {
      const { createInMemoryDb } = await import("@/lib/test-utils/inMemoryDb");
      db = createInMemoryDb() as unknown as Db;
      const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");
      await bootstrapGameWorld({
        db,
        preset: "1991-default",
        resetReference: true,
        log: () => {},
        fresh1991VehicleModelSeed: true,
        fresh1991MediaTaxonomySeed: true,
      });
    }, 900_000);

    it("fits the US book to the authored composition and leaves UK and JP unchanged", async () => {
      const { refreshNationalBudgetRevenue } = await import("@/lib/budget/revenue");
      const { getAuthoredNationalSpending1991 } = await import("@/lib/seeds/reference/budgets");
      const authored = getAuthoredNationalSpending1991("US")!;
      const authoredTotal = Object.values(authored).reduce((a, b) => a + b, 0);
      const authoredShare = Object.fromEntries(
        Object.entries(authored).map(([category, amount]) => [
          category,
          round(amount / authoredTotal, 4),
        ])
      );
      const usBudget = (await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ _id: "federal" }))!;
      const seeded = await snapshot();
      const refreshes: Row[][] = [];
      for (let i = 0; i < 3; i++) {
        await refreshNationalBudgetRevenue(db, ["federal", "UK", "JP"]);
        refreshes.push(await snapshot());
      }
      const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as {
        sourceCommit: string;
        afterRefresh: Row[][];
      };
      const report = {
        issue: 3327,
        sourceCommit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
        baselineReport: { path: BASELINE, sourceCommit: baseline.sourceCommit },
        preset: "1991-default",
        fixture: "in-memory bootstrapGameWorld, resetReference",
        usAuthoredProgramShare: authoredShare,
        usProgramCostScaleBaseline: usBudget.programCostScaleBaseline,
        usProgramCostScaleByCategoryBaseline: usBudget.programCostScaleByCategoryBaseline,
        usBeforeAfterRefresh: baseline.afterRefresh.at(-1)!.find((row) => row.country === "US"),
        seeded,
        afterRefresh: refreshes,
      };
      console.info(JSON.stringify(report, null, 2));
      writeFileSync(
        "scripts/sim/usOpeningComposition1991.report.json",
        `${JSON.stringify(report, null, 2)}\n`
      );

      for (const row of [...seeded, ...refreshes.flat()]) {
        expect(row.balanceGdpPercent, row.country).toBeGreaterThanOrEqual(-0.75);
        expect(row.balanceGdpPercent, row.country).toBeLessThanOrEqual(0.25);
      }
      for (const rows of [seeded, ...refreshes]) {
        const us = rows.find((row) => row.country === "US")!;
        for (const [category, share] of Object.entries(authoredShare)) {
          expect(us.programShare![category], category).toBeCloseTo(share, 3);
        }
      }
      const us = refreshes.at(-1)!.find((row) => row.country === "US")!;
      expect(us.categoryGdpPercent.defense).toBeLessThan(5);
      expect(us.categoryGdpPercent.healthcare).toBeGreaterThan(1);
      expect(us.categoryGdpPercent.socialSecurity).toBeGreaterThan(
        us.categoryGdpPercent.healthcare
      );

      // UK and JP: identical receipts, spending and categories to the 3292 report.
      const before = baseline.afterRefresh.at(-1)!;
      for (const country of ["UK", "JP"]) {
        const prior = before.find((row) => row.country === country)!;
        const now = refreshes.at(-1)!.find((row) => row.country === country)!;
        expect(Math.abs(now.revenue / prior.revenue - 1), country).toBeLessThan(1e-9);
        expect(Math.abs(now.spending / prior.spending - 1), country).toBeLessThan(1e-9);
        expect(now.categoryGdpPercent, country).toEqual(prior.categoryGdpPercent);
      }
    }, 120_000);
  }
);
