/**
 * Issue 3292 qualification: bootstrap an isolated in-memory 1991 world from
 * this checkout and report the player openings after seed and after repeated
 * runtime budget refreshes. No live or sandbox database is touched.
 *
 *   AHD_SIM_REPORT=1 npx vitest run scripts/sim/ukOpeningFiscal1991.test.ts
 *
 * Skipped without AHD_SIM_REPORT; resetEconomicOpening.integration.test.ts
 * carries the same two-sided gate in the default suite.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";

let db: Db;
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => db),
  getMongoClient: vi.fn(async () => ({ db: () => ({ command: async () => ({}) }) })),
}));

const PLAYERS = ["US", "UK", "JP"] as const;

function snapshot(budgets: FederalBudget[]) {
  return budgets
    .filter((budget) => (PLAYERS as readonly string[]).includes(budget.countryId!))
    .map((budget) => ({
      country: budget.countryId,
      revenue: budget.revenue.total,
      spending: budget.spending.total,
      balanceGdpPercent: (100 * budget.surplus) / budget.gdp,
      spendingGdpPercent: (100 * budget.spending.total) / budget.gdp,
      categoryGdpPercent: Object.fromEntries(
        Object.entries(budget.spending.byCategory).map(([category, amount]) => [
          category,
          Math.round((10_000 * amount) / budget.gdp) / 100,
        ])
      ),
    }))
    .sort((a, b) => String(a.country).localeCompare(String(b.country)));
}

describe.runIf(process.env.AHD_SIM_REPORT === "1")(
  "1991 player fiscal openings (issue 3292)",
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
      });
    }, 900_000);

    it("opens every player near the 0.5%-GDP deficit envelope and holds it", async () => {
      const { refreshNationalBudgetRevenue } = await import("@/lib/budget/revenue");
      const read = async () =>
        snapshot(await db.collection<FederalBudget>("federalBudget").find({}).toArray());
      const seeded = await read();
      const refreshes = [];
      for (let i = 0; i < 3; i++) {
        await refreshNationalBudgetRevenue(db, ["federal", "UK", "JP"]);
        refreshes.push(await read());
      }
      const report = {
        issue: 3292,
        sourceCommit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
        preset: "1991-default",
        fixture: "in-memory bootstrapGameWorld, resetReference",
        seeded,
        afterRefresh: refreshes,
      };
      console.info(JSON.stringify(report, null, 2));
      writeFileSync("scripts/sim/ukOpeningFiscal1991.report.json", JSON.stringify(report, null, 2));
      for (const row of [...seeded, ...refreshes.flat()]) {
        expect(row.balanceGdpPercent, row.country).toBeGreaterThanOrEqual(-0.75);
        expect(row.balanceGdpPercent, row.country).toBeLessThanOrEqual(0.25);
      }
      const uk = refreshes.at(-1)!.find((row) => row.country === "UK")!;
      // HM Treasury FY1991/92 composition: social programs outweigh defence.
      expect(uk.categoryGdpPercent.health).toBeGreaterThan(uk.categoryGdpPercent.defense!);
      expect(uk.categoryGdpPercent.welfare).toBeGreaterThan(uk.categoryGdpPercent.defense!);
      expect(uk.categoryGdpPercent.defense).toBeLessThan(5);
    }, 120_000);
  }
);
