import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasGdpBaseline } from "./gdpBaseline";

/**
 * Every country a 1953 world can seed regions for must have a GDP baseline row.
 *
 * ⚠️ WHY THIS EXISTS. `resolveCampaignGdpBaseline` throws for a country with no
 * row — deliberately, so a new country can never silently inherit a US
 * denomination. But nothing connected that throw to the set of countries a
 * world actually seeds, so a country could ship regions, parties and offices
 * and still have no row. That is not hypothetical: DD (the GDR) shipped a full
 * 1953 Länder bundle with no baseline, and every DD player's `/profile` render
 * threw for it — a production 500 on an unrelated-looking surface (the report
 * came in as "cannot log in via Discord", because the crash lands on the page
 * the OAuth round-trip redirects to).
 *
 * ⚠️ DERIVED FROM THE FILESYSTEM, not from a hand-kept list. A list of country
 * ids here would go stale the moment the twenty-seventh country landed, which
 * is precisely the failure being guarded against. The country id is the FOLDER
 * name uppercased, not the file prefix — `countries/ukr/data/uaRegions1953.ts`
 * is UKR, not UA.
 *
 * US is absent below by construction: its 1953 bundle is
 * `seeds/reference/states1953.ts`, not a country-folder module. It has a row.
 */
const COUNTRIES_DIR = "src/lib/countries";

function countriesWith1953RegionBundle(): string[] {
  return readdirSync(COUNTRIES_DIR)
    .filter((cc) => statSync(join(COUNTRIES_DIR, cc)).isDirectory())
    .filter((cc) => {
      const dataDir = join(COUNTRIES_DIR, cc, "data");
      if (!existsSync(dataDir)) return false;
      return readdirSync(dataDir).some((f) => /Regions1953\.ts$/.test(f));
    })
    .map((cc) => cc.toUpperCase())
    .sort();
}

/**
 * Countries that seed 1953 regions but have no baseline row yet.
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
  "RU",
  "SE",
  "TR",
  "UKR",
  "YU",
];

describe("gdpBaseline coverage over 1953-seedable countries", () => {
  it("finds the 1953 region bundles on disk", () => {
    // Guards the scanner itself: a rename that matched nothing would make every
    // assertion below vacuously true.
    const found = countriesWith1953RegionBundle();
    expect(found.length).toBeGreaterThan(20);
    expect(found).toContain("DD");
    expect(found).toContain("UKR");
  });

  it("gives every 1953-seedable country a baseline row, except the pending ones", () => {
    const missing = countriesWith1953RegionBundle().filter((cc) => !hasGdpBaseline(cc));

    expect(
      missing,
      "A country that seeds 1953 regions with no GDP baseline row throws out of " +
        "resolveCampaignGdpBaseline on every money path that reaches it, including " +
        "the /profile render. Add its row to GDP_BASELINE_TABLE (derive the cells " +
        "with gdpBaseline.table.test.ts) and delete it from PENDING_BASELINE — or, " +
        "if the row is not ready, add it to PENDING_BASELINE deliberately."
    ).toEqual([...PENDING_BASELINE].sort());
  });

  it("keeps DD covered — the country this guard was written for", () => {
    expect(hasGdpBaseline("DD")).toBe(true);
    expect(PENDING_BASELINE).not.toContain("DD");
  });
});
