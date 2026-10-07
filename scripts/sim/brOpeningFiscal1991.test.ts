/**
 * Issue 3372 qualification: bootstrap an isolated in-memory 1991 world from
 * this checkout and report the Brazilian fiscal opening after seed and after
 * repeated runtime budget refreshes, against the authored 1991 category mix.
 * The US, UK and JP openings are compared with the checked-in issue 3327
 * report to show they are unchanged. No live or sandbox database is touched.
 *
 *   AHD_SIM_REPORT=1 npx vitest run scripts/sim/brOpeningFiscal1991.test.ts
 *
 * Skipped without AHD_SIM_REPORT; budgets.openingBalance1991.test.ts carries
 * the generator gate in the default suite.
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

const BUDGET_IDS = ["BR", "federal", "UK", "JP"] as const;
const BASELINE = "scripts/sim/usOpeningComposition1991.report.json";
// Authored 1991 relative mix (billions BRL); the opening size comes from receipts.
const AUTHORED = {
  healthcare: 25,
  education: 30,
  socialSecurity: 90,
  defense: 10,
  infrastructure: 15,
  other: 60,
  stateGrants: 70,
};
// Issue 3372 live and generator reproduction before this change.
const BEFORE = { programs: 28_679_520_000, gdpPercent: 3.19, balanceGdpPercent: 12.47 };

type Row = {
  country: string;
  revenue: number;
  spending: number;
  programs: number;
  balanceGdpPercent: number;
  categoryGdpPercent: Record<string, number>;
  programShare?: Record<string, number>;
};

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

async function snapshot(): Promise<Row[]> {
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ _id: { $in: [...BUDGET_IDS] } })
    .toArray();
  return budgets
    .map((budget) => {
      const programs = budget.spending.total - budget.spending.debtInterest;
      const row: Row = {
        country: budget.countryId!,
        revenue: budget.revenue.total,
        spending: budget.spending.total,
        programs,
        balanceGdpPercent: (100 * budget.surplus) / budget.gdp,
        categoryGdpPercent: Object.fromEntries(
          Object.entries(budget.spending.byCategory).map(([category, amount]) => [
            category,
            round((100 * amount) / budget.gdp, 2),
          ])
        ),
      };
      if (budget.countryId === "BR") {
        row.programShare = Object.fromEntries(
          [
            ...Object.entries(budget.spending.byCategory),
            ["stateGrants", budget.spending.stateGrants] as const,
          ]
            .filter(([, amount]) => amount > 0)
            .map(([category, amount]) => [category, round(amount / programs, 4)])
        );
      }
      return row;
    })
    .sort((a, b) => a.country.localeCompare(b.country));
}

describe.runIf(process.env.AHD_SIM_REPORT === "1")(
  "1991 Brazil fiscal opening (issue 3372)",
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

    it("sizes Brazil's authored mix to the opening envelope and leaves US, UK, JP unchanged", async () => {
      const { refreshNationalBudgetRevenue } = await import("@/lib/budget/revenue");
      const authoredTotal = Object.values(AUTHORED).reduce((a, b) => a + b, 0);
      const authoredShare = Object.fromEntries(
        Object.entries(AUTHORED).map(([category, amount]) => [
          category,
          round(amount / authoredTotal, 4),
        ])
      );
      const seeded = await snapshot();
      const refreshes: Row[][] = [];
      for (let i = 0; i < 3; i++) {
        await refreshNationalBudgetRevenue(db, [...BUDGET_IDS]);
        refreshes.push(await snapshot());
      }
      const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as {
        sourceCommit: string;
        afterRefresh: Row[][];
      };
      const report = {
        issue: 3372,
        sourceCommit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
        baselineReport: { path: BASELINE, sourceCommit: baseline.sourceCommit },
        preset: "1991-default",
        fixture: "in-memory bootstrapGameWorld, resetReference",
        brAuthoredProgramShare: authoredShare,
        brBefore: BEFORE,
        seeded,
        afterRefresh: refreshes,
      };
      console.info(JSON.stringify(report, null, 2));
      writeFileSync(
        "scripts/sim/brOpeningFiscal1991.report.json",
        `${JSON.stringify(report, null, 2)}\n`
      );

      for (const rows of [seeded, ...refreshes]) {
        const br = rows.find((row) => row.country === "BR")!;
        expect(br.balanceGdpPercent).toBeGreaterThanOrEqual(-0.75);
        expect(br.balanceGdpPercent).toBeLessThanOrEqual(0.25);
        expect(br.categoryGdpPercent.health).toBeUndefined();
        for (const [category, share] of Object.entries(authoredShare)) {
          expect(br.programShare![category], category).toBeCloseTo(share, 3);
        }
        expect(br.programs).toBeGreaterThan(3 * BEFORE.programs);
      }

      const before = baseline.afterRefresh.at(-1)!;
      for (const country of ["US", "UK", "JP"]) {
        const prior = before.find((row) => row.country === country)!;
        const now = refreshes.at(-1)!.find((row) => row.country === country)!;
        expect(Math.abs(now.revenue / prior.revenue - 1), country).toBeLessThan(1e-9);
        expect(Math.abs(now.spending / prior.spending - 1), country).toBeLessThan(1e-9);
      }
    }, 120_000);
  }
);
