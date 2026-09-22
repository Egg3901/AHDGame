import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasGdpBaseline } from "./gdpBaseline";

/**
 * Every country a world can seed regions for must have a GDP baseline row.
 *
 * ⚠️ WHY THIS EXISTS. `resolveCampaignGdpBaseline` throws for a country with no
 * row — deliberately, so a new country can never silently inherit a US
 * denomination. But nothing connected that throw to the set of countries a
 * world actually seeds, so a country could ship regions, parties and offices
 * and still have no row. That is not hypothetical: DD (the GDR) and RU (the
 * USSR) both shipped full region bundles with no baseline.
 *
 * DD's showed up as a `/profile` 500 for its own players, reported as "cannot
 * log in via Discord" because the crash lands on the page the OAuth round-trip
 * redirects to. RU's was quieter and much worse: `processFundGeneration` loops
 * every character with no per-character catch and writes only after the loop,
 * and `runPhase` turns a throw into an aborted phase — so one RU character cost
 * EVERY player that turn's campaign income, and took `partyGOTV` and
 * `caucusTax` down with it.
 *
 * ⚠️ ANY ERA BUNDLE COUNTS, not just 1953. Scoping this to `*Regions1953.ts`
 * looks right — DD is a 1953 country and 1953 is the live preset — and it
 * silently misses SCO and WAL, which ship only a base `*Regions.ts` and would
 * 500 exactly the way DD did. The question is "can a world seed regions for
 * this country", not "which era did the last bug come from".
 *
 * ⚠️ DERIVED FROM THE FILESYSTEM, not from a hand-kept list. A list of country
 * ids here would go stale the moment the next country landed, which is
 * precisely the failure being guarded against. The country id is the FOLDER
 * name uppercased, not the file prefix — `countries/ukr/data/uaRegions1953.ts`
 * is UKR, not UA.
 *
 * US is absent below by construction: its bundles are `seeds/reference/states*.ts`,
 * not country-folder modules. It has a row.
 */
const COUNTRIES_DIR = "src/lib/countries";

/**
 * Matches a region bundle — `ddRegions.ts`, `ddRegions1953.ts` — and nothing
 * else in the folder. `Regions` must sit immediately before the optional era
 * digits, so neighbours like `ddRegionImages.ts` and
 * `ddRegionCensusData1953.ts` do not count as bundles.
 */
const REGION_BUNDLE = /Regions\d*\.ts$/;

function countriesWithRegionBundle(): string[] {
  return readdirSync(COUNTRIES_DIR)
    .filter((cc) => statSync(join(COUNTRIES_DIR, cc)).isDirectory())
    .filter((cc) => {
      const dataDir = join(COUNTRIES_DIR, cc, "data");
      if (!existsSync(dataDir)) return false;
      return readdirSync(dataDir).some((f) => REGION_BUNDLE.test(f));
    })
    .map((cc) => cc.toUpperCase())
    .sort();
}

/**
 * Countries that seed regions but have no baseline row yet.
 *
 * ⚠️ THIS LIST ONLY SHRINKS. It is a two-way pin, not a mute button: the
 * assertion below compares it for EQUALITY against what is actually missing, so
 * adding a country without a row fails (the set grew), and adding a row without
 * deleting the entry here fails too (the set shrank). Either way the failure
 * names the country.
 *
 * Deriving a row is not a judgement call — `gdpBaseline.table.test.ts`
 * recomputes every cell from the seed bundles — but the resulting numbers move
 * campaign income and action costs, so each one needs its own calibration
 * review and simulation report before it lands. They are filled in as that
 * review happens, not in bulk.
 */
const PENDING_BASELINE: readonly string[] = [
  "AT",
  "BAL",
  "BG",
  "BLR",
  "BR",
  "CS",
  "ES",
  "FI",
  "FR",
  "GR",
  "HU",
  "IT",
  "PL",
  "RO",
  "SCO",
  "SE",
  "TR",
  "UKR",
  "WAL",
  "YU",
];

describe("gdpBaseline coverage over region-seeding countries", () => {
  it("finds the region bundles on disk", () => {
    // Guards the scanner itself: a rename that matched nothing would make every
    // assertion below vacuously true.
    const found = countriesWithRegionBundle();
    expect(found.length).toBeGreaterThan(20);
    expect(found).toContain("DD");
    // Folder name, not file prefix (`uaRegions1953.ts` lives in `ukr/`).
    expect(found).toContain("UKR");
    // Base-bundle-only countries: the case the 1953-scoped scanner missed.
    expect(found).toContain("SCO");
    expect(found).toContain("WAL");
  });

  it("does not mistake a neighbouring region module for a bundle", () => {
    // `ddRegionImages.ts` and `ddRegionCensusData1953.ts` sit in the same
    // folder; a looser pattern would match them and the scan would stop
    // meaning anything.
    expect(REGION_BUNDLE.test("ddRegions.ts")).toBe(true);
    expect(REGION_BUNDLE.test("ddRegions1953.ts")).toBe(true);
    expect(REGION_BUNDLE.test("ddRegionImages.ts")).toBe(false);
    expect(REGION_BUNDLE.test("ddRegionCensusData1953.ts")).toBe(false);
  });

  it("gives every region-seeding country a baseline row, except the pending ones", () => {
    const missing = countriesWithRegionBundle().filter((cc) => !hasGdpBaseline(cc));

    expect(
      missing,
      "A country that seeds regions with no GDP baseline row throws out of " +
        "resolveCampaignGdpBaseline on every money path that reaches it, including " +
        "the /profile render. Add its row to GDP_BASELINE_TABLE (derive the cells " +
        "with gdpBaseline.table.test.ts) and delete it from PENDING_BASELINE — or, " +
        "if the row is not ready, add it to PENDING_BASELINE deliberately."
    ).toEqual([...PENDING_BASELINE].sort());
  });

  it("keeps DD and RU covered — the two this guard was written for", () => {
    // Both were throwing in production: DD on the `/profile` render, and both
    // inside the turn processor, where a throw aborts the whole phase for every
    // player rather than just the country that caused it.
    for (const cc of ["DD", "RU"]) {
      expect(hasGdpBaseline(cc), `hasGdpBaseline(${cc})`).toBe(true);
      expect(PENDING_BASELINE, `PENDING_BASELINE contains ${cc}`).not.toContain(cc);
    }
  });
});
