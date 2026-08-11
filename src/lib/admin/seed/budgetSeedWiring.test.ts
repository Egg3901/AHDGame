/**
 * Contract test for WHERE the US budget bundle is seeded.
 *
 * `seedBudgets` owns US-only budget data: the federal budget, US enacted laws,
 * US state budgets, the US country-owned corporation and formula grants. It ran
 * TWICE per orchestrated bootstrap — once from inside `runSeed`, once as the US
 * member of `bootstrapGameWorld`'s per-country budget block — at roughly 170
 * one-document round trips a pass.
 *
 * The late call is the one that survives, deliberately:
 *   - it sits in the per-country budget block beside the other 15 countries;
 *   - it runs AFTER the `commandEconomyEnabled` gate write, which the budget
 *     seeders read;
 *   - it is already the last word on every collection `seedBudgets` touches, so
 *     dropping the early pass cannot change the final state.
 *
 * That last point holds only because nothing between the two calls reads US
 * budget data. The in-window seeders (the UK/JP/DE/BR packs, the Warsaw-Pact
 * block) scope every budget write to their own `countryId`; the diagnostic,
 * sovereign-bond and fiscal-year readers all run later.
 *
 * Asserted against source text rather than by driving the functions, for the
 * same reason as `regionDerivedStageWiring.test.ts`: `seedAllCountryData` calls
 * ~100 seeders and `runSeed` reaches `getDb()`, so neither runs without a live
 * database.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src", "lib", "admin");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

describe("US budget seed wiring", () => {
  it("seedAllCountryData opts out of runSeed's budget pass", () => {
    const source = read("bootstrapGameWorld.ts");
    const call = source.match(/await runSeed\(\{[^}]*\}\)/);
    expect(call, "seedAllCountryData no longer calls runSeed").not.toBeNull();
    expect(call![0]).toContain("includeBudgets: false");
  });

  it("bootstrap seeds the US budget bundle exactly once", () => {
    const source = read("bootstrapGameWorld.ts");
    const calls = source.match(/seedBudgets\(db, resetReference, log, preset\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("runSeed still seeds budgets by default, for the standalone callers", () => {
    // POST /api/seed and scripts/seed/seed.ts pass no flag and never reach
    // bootstrapGameWorld, so they must keep rebuilding the US bundle.
    const source = read("seed/runCoreSeed.ts");
    expect(source).toContain("includeBudgets = true");
  });

  it("the surviving call runs after the command-economy gate write", () => {
    // This is WHY the late call is the one kept. The budget seeders read
    // `commandEconomyEnabled`; the early call preceded the write that sets it.
    const source = read("bootstrapGameWorld.ts");
    const gate = source.indexOf("commandEconomyEnabledBy");
    const seed = source.indexOf('guarded("seedBudgets"');
    expect(gate).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(gate);
  });
});
