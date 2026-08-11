/**
 * Contract test for the ORDER the state-GDP reconciliation depends on.
 *
 * `reconcileStateGdpWithNationalSeeds` rescales regional gdp to the authored
 * national figure. It must run after every country's regions exist and before
 * anything that derives absolute values from `state.gdp` — state budgets,
 * country-owned corp sizing, unowned-sector market sizing.
 *
 * It used to be called twice: once at the end of `seedAllCountryData`, and once
 * per Warsaw-Pact country inside `seedEasternBlocBudget`, whose comment said
 * bloc regions seeded after the first pass. That stopped being true when the
 * bloc country block moved inside `seedAllCountryData`, making the second call
 * six no-op passes (MEASURED: all six logged "all countries within tolerance").
 *
 * Removing it is only safe while the bloc BUDGET block still runs after the
 * reconcile. That is what this pins. If the block is ever moved ahead of the
 * pass, this test fails and the per-country call must come back — deleting the
 * test instead would reintroduce a silent mis-scaling: budgets, corp sizing and
 * market sizing would all be derived from unnormalized regional gdp, and no row
 * count would change.
 *
 * Source-text assertions for the same reason as
 * `regionDerivedStageWiring.test.ts`: neither function runs without a live db.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src", "lib", "admin");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

describe("state-GDP reconcile ordering", () => {
  it("runs exactly once, from seedAllCountryData", () => {
    const source = read("bootstrapGameWorld.ts");
    const calls = source.match(/await reconcileStateGdpWithNationalSeeds\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("the bloc budget block runs after the reconcile", () => {
    // The whole basis for dropping the per-country repeat.
    const source = read("bootstrapGameWorld.ts");
    const reconcile = source.indexOf("await reconcileStateGdpWithNationalSeeds(");
    const blocBudgets = source.indexOf("seedEasternBlocBudget:");
    expect(reconcile).toBeGreaterThan(-1);
    expect(blocBudgets).toBeGreaterThan(-1);
    expect(blocBudgets).toBeGreaterThan(reconcile);
  });

  it("bloc regions are seeded before the reconcile", () => {
    // The other half: the pass can only cover bloc countries if their regions
    // already exist when it runs.
    const source = read("bootstrapGameWorld.ts");
    // The six satellites are seeded concurrently inside the country-pack block,
    // so this is a `.map(...)` rather than a bare await. The ORDERING it pins is
    // unchanged: bloc regions still exist before the reconcile runs.
    const blocCountry = source.indexOf("seedEasternBlocCountry(db, resetReference");
    const reconcile = source.indexOf("await reconcileStateGdpWithNationalSeeds(");
    expect(blocCountry).toBeGreaterThan(-1);
    expect(blocCountry).toBeLessThan(reconcile);
  });

  it("seedEasternBlocBudget no longer reconciles on its own", () => {
    const source = read("seed/seedEasternBloc.ts");
    expect(source).not.toContain("reconcileStateGdpWithNationalSeeds(db");
  });
});
