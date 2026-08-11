import type { Db } from "mongodb";
import { ok, warn, critical } from "./checkFactory";
import { expectedRegionDerivedCoverage, type SeedExpectations } from "./expectations";
import type { SeedDiagnosticCheck } from "./types";

/**
 * Coverage of the region-derived collections — the diagnostic's blind spot.
 *
 * These six had ZERO mentions anywhere in `seedDiagnostic/`, which is why the
 * worst seed defect on record passed a clean run: the region-derived seeders
 * fired while only US states existed, leaving `militaryUnits` at 13 documents
 * across 1 country against 226 regions in 24 countries, and `stateRegistrationPool`
 * emptied entirely. Row counts alone would not have caught it either — what makes
 * it unmistakable is the country SET, so that is what this compares.
 *
 * Expectations resolve through each seeder's own gating config
 * (`expectedRegionDerivedCoverage`), never a hard-coded roster, so this cannot
 * become the era-blind expectation that produced the DE RegionMetrics false
 * positive.
 *
 * Severity follows the established rule: nothing at all where something is owed
 * is `missing` (critical); partial coverage is a warning naming the countries.
 */
export async function checkRegionDerivedCoverage(
  db: Db,
  expect: SeedExpectations
): Promise<SeedDiagnosticCheck[]> {
  const checks: SeedDiagnosticCheck[] = [];
  const groups = expectedRegionDerivedCoverage(expect.preset, expect.seededCountryIds);

  // One distinct() per collection rather than a probe per country.
  const actuals = await Promise.all(
    groups.map(async ({ collection }) => ({
      collection,
      countries: new Set((await db.collection(collection).distinct("countryId")).map(String)),
    }))
  );
  const actualByCollection = new Map(actuals.map((a) => [a.collection, a.countries]));

  for (const { collection, countries, note } of groups) {
    const actual = actualByCollection.get(collection) ?? new Set<string>();
    const missing = countries.filter((c) => !actual.has(c));
    const id = `regionDerived.${collection}.coverage`;

    if (countries.length === 0) {
      checks.push(
        ok(id, "global", `${collection}.countries`, 0, actual.size, `${note} — none expected`)
      );
      continue;
    }
    if (actual.size === 0) {
      checks.push(
        critical(
          id,
          "global",
          `${collection}.countries`,
          countries.length,
          0,
          `${note} — seeded nothing`
        )
      );
      continue;
    }
    checks.push(
      missing.length === 0
        ? ok(id, "global", `${collection}.countries`, countries.length, actual.size, note)
        : warn(
            id,
            "global",
            `${collection}.countries`,
            countries.length,
            actual.size,
            `${note} — missing ${missing.join(" ")}`
          )
    );
  }

  // US-only, and the one `runSeed --reset` used to empty with nothing to rebuild
  // it (MEASURED 51 -> 0). Presence is the whole check.
  const poolRows = await db.collection("stateRegistrationPool").countDocuments();
  checks.push(
    poolRows > 0
      ? ok(
          "regionDerived.stateRegistrationPool.count",
          "US",
          "stateRegistrationPool.count",
          ">0",
          poolRows
        )
      : critical(
          "regionDerived.stateRegistrationPool.count",
          "US",
          "stateRegistrationPool.count",
          ">0",
          0,
          "sole seeder is seedRegistrationLanes; a reset that drops this cannot rebuild it"
        )
  );

  return checks;
}
