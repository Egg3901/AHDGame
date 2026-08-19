/**
 * G1 report: granular-electorate substrate coverage, country by country.
 *
 * Run: npx tsx scripts/audit/substrate-coverage.ts
 *
 * Prints one line per country and a full listing of every region/era that has
 * no substrate. A gap here is a region that renders and votes today only
 * because the legacy archetype documents catch it; delete those and the same
 * region has no electorate at all. The permanent version of this check is
 * `src/lib/demographics/substrateCoverage.test.ts` — this script exists for the
 * reviewable table, not the pass/fail.
 */

import { ALL_COUNTRY_IDS } from "../../src/lib/constants/countries";
import {
  coverageForCountry,
  failingRows,
  type CoverageRow,
} from "../../src/lib/demographics/substrateCoverage";

async function main(): Promise<void> {
  const all: CoverageRow[] = [];
  for (const countryId of ALL_COUNTRY_IDS) {
    const rows = await coverageForCountry(countryId);
    const bad = failingRows(rows);
    all.push(...rows);
    const status = bad.length === 0 ? "ok" : `${bad.length} GAP`;
    console.log(
      `${countryId.padEnd(4)} ${String(rows.length).padStart(4)} probes  ${status}`.trimEnd()
    );
  }

  const bad = failingRows(all);
  console.log(`\n${all.length} probes, ${bad.length} gaps\n`);
  if (bad.length === 0) {
    console.log("G1 clean: every seeded region derives a substrate in every era it seeds in.");
    return;
  }
  console.log("country era  region               units  shareSum  year");
  for (const r of bad) {
    console.log(
      [
        r.countryId.padEnd(7),
        r.era.padEnd(4),
        r.regionId.padEnd(20),
        String(r.units ?? "null").padStart(5),
        (r.shareSum == null ? "null" : r.shareSum.toFixed(6)).padStart(9),
        String(r.year ?? "preset").padStart(6),
      ].join(" ")
    );
  }
  process.exitCode = 1;
}

void main();
