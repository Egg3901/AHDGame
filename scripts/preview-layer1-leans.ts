/**
 * Dry-run preview: computes what Demographics Layer-1 Positions would produce
 * if the feature flag were enabled, and diffs against current prod DB values.
 * READ-ONLY — no writes to the database.
 *
 * Usage:
 *   npx tsx scripts/preview-layer1-leans.ts                     # all eras, all countries
 *   npx tsx scripts/preview-layer1-leans.ts --era=2019          # US + intl for era 2019 only
 *   npx tsx scripts/preview-layer1-leans.ts --country=US        # US all eras
 *   npx tsx scripts/preview-layer1-leans.ts --country=UK --era=1979
 *   npx tsx scripts/preview-layer1-leans.ts --flips-only        # only print flagged rows
 */

import { connectDb, closeDb } from "./utils/db";
import {
  generateStateDemographicsForTest,
  type Layer1Config,
} from "../src/lib/seeds/stateDemographics";
import { demographicCategories } from "../src/lib/seeds/demographicCategories";
import { calculateStateLean } from "../src/lib/utils/demographics";
import {
  getCountryLayer1Model,
  buildModelRegionDemographics,
} from "../src/lib/seeds/international/index";
import { stateCensusData } from "../src/lib/seeds/stateCensusData";
import { stateCensusData1979 } from "../src/lib/seeds/stateCensusData1979";
import { stateCensusData1991 } from "../src/lib/seeds/stateCensusData1991";
import { stateCensusData1999 } from "../src/lib/seeds/stateCensusData1999";
import { stateCensusData2007 } from "../src/lib/seeds/stateCensusData2007";
import { stateCensusData2023 } from "../src/lib/seeds/stateCensusData2023";
import type { StateDemographics, DemographicCategory } from "../src/lib/db/types";
import type { EraId } from "../src/lib/seeds/presetSelector";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const filterEra = args.find((a) => a.startsWith("--era="))?.split("=")[1] as EraId | undefined;
const filterCountry = args.find((a) => a.startsWith("--country="))?.split("=")[1];
const flipsOnly = args.includes("--flips-only");

const ALL_ERAS: EraId[] = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"];
const INTL_COUNTRIES = [
  "UK",
  "DE",
  "JP",
  "BR",
  "CN",
  "NG",
  "FR",
  "SE",
  "IT",
  "ES",
  "TR",
  "RU",
  "DD",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "BY",
  "CS",
  "BAL",
  "IE",
];

const US_CENSUS: Record<EraId, Record<string, Layer1Config>> = {
  "1953": stateCensusData1979 as Record<string, Layer1Config>, // 1979 nearest proxy
  "1979": stateCensusData1979 as Record<string, Layer1Config>,
  "1991": stateCensusData1991 as Record<string, Layer1Config>,
  "1999": stateCensusData1999 as Record<string, Layer1Config>,
  "2007": stateCensusData2007 as Record<string, Layer1Config>,
  "2019": stateCensusData as Record<string, Layer1Config>,
  "2023": stateCensusData2023 as Record<string, Layer1Config>,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateLean(sd: StateDemographics, cats: DemographicCategory[]) {
  return calculateStateLean(sd, cats);
}

interface RegionResult {
  id: string;
  legacyEcon: number | null;
  legacySocial: number | null;
  newEcon: number;
  newSocial: number;
  isNew: boolean;
}

function classify(r: RegionResult): string[] {
  const flags: string[] = [];
  if (r.isNew) {
    flags.push("[NEW]");
    return flags;
  }
  const dE = r.newEcon - (r.legacyEcon ?? 0);
  const dS = r.newSocial - (r.legacySocial ?? 0);
  if (
    (r.legacyEcon !== null &&
      Math.sign(r.newEcon) !== Math.sign(r.legacyEcon) &&
      r.legacyEcon !== 0) ||
    (r.legacySocial !== null &&
      Math.sign(r.newSocial) !== Math.sign(r.legacySocial) &&
      r.legacySocial !== 0)
  )
    flags.push("[FLIP]");
  if (Math.abs(dE) > 1.0 || Math.abs(dS) > 1.0) flags.push("[LARGE]");
  return flags;
}

function printRow(r: RegionResult) {
  const flags = classify(r);
  const isFlagged = flags.length > 0;
  if (flipsOnly && !isFlagged) return;

  const lE = r.legacyEcon !== null ? r.legacyEcon.toFixed(2).padStart(6) : "   N/A";
  const lS = r.legacySocial !== null ? r.legacySocial.toFixed(2).padStart(6) : "   N/A";
  const nE = r.newEcon.toFixed(2).padStart(6);
  const nS = r.newSocial.toFixed(2).padStart(6);
  const dE = r.legacyEcon !== null ? (r.newEcon - r.legacyEcon).toFixed(2).padStart(6) : "   N/A";
  const dS =
    r.legacySocial !== null ? (r.newSocial - r.legacySocial).toFixed(2).padStart(6) : "   N/A";
  const flagStr = flags.join(" ").padEnd(14);
  console.log(
    `  ${r.id.padEnd(6)} | leg ${lE} ${lS} | new ${nE} ${nS} | Δ ${dE} ${dS} | ${flagStr}`
  );
}

interface SectionSummary {
  flips: number;
  large: number;
  newRegions: number;
  total: number;
}

function printSectionSummary(label: string, results: RegionResult[]) {
  let flips = 0,
    large = 0,
    newRegions = 0;
  for (const r of results) {
    const flags = classify(r);
    if (flags.includes("[FLIP]")) flips++;
    if (flags.includes("[LARGE]")) large++;
    if (flags.includes("[NEW]")) newRegions++;
  }
  console.log(
    `  ─── ${label}: ${results.length} regions | flips=${flips} large=${large} new=${newRegions} ───`
  );
  return { flips, large, newRegions, total: results.length } as SectionSummary;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Layer-1 Lean Preview (read-only) ===");
  console.log(
    `Filters: era=${filterEra ?? "all"} country=${filterCountry ?? "all"} flips-only=${flipsOnly}\n`
  );

  const db = await connectDb();
  const sdColl = db.collection<StateDemographics>("stateDemographics");

  const eras = filterEra ? [filterEra] : ALL_ERAS;

  let grandFlips = 0,
    grandLarge = 0,
    grandNew = 0,
    grandTotal = 0;

  // ── US ───────────────────────────────────────────────────────────────────

  if (!filterCountry || filterCountry === "US") {
    console.log("══ US ══════════════════════════════════════════════════════════");
    for (const era of eras) {
      const bundle = US_CENSUS[era];
      if (!bundle || Object.keys(bundle).length === 0) {
        console.log(`  [ERA ${era}] no census bundle — skipped`);
        continue;
      }
      console.log(`\n── US / ${era} ──`);
      console.log("  region | legacy econ  soc | new  econ  soc | Δ econ  soc | flags");

      const stateIds = Object.keys(bundle);
      const dbDocs = await sdColl.find({ _id: { $in: stateIds } }).toArray();
      const dbMap = new Map(dbDocs.map((d) => [d._id as string, d]));

      const results: RegionResult[] = [];
      for (const [stateId, config] of Object.entries(bundle)) {
        const newSd = generateStateDemographicsForTest(stateId, config, era, {
          layer1Positions: true,
        });
        const newLean = stateLean(newSd, demographicCategories);

        const existing = dbMap.get(stateId);
        let legacyEcon: number | null = null;
        let legacySocial: number | null = null;
        if (existing) {
          const l = stateLean(existing, demographicCategories);
          legacyEcon = l.economicLean;
          legacySocial = l.socialLean;
        }

        const r: RegionResult = {
          id: stateId,
          legacyEcon,
          legacySocial,
          newEcon: newLean.economicLean,
          newSocial: newLean.socialLean,
          isNew: !existing,
        };
        results.push(r);
        printRow(r);
      }

      const s = printSectionSummary(`US/${era}`, results);
      grandFlips += s.flips;
      grandLarge += s.large;
      grandNew += s.newRegions;
      grandTotal += s.total;
    }
  }

  // ── International ─────────────────────────────────────────────────────────

  const countries = filterCountry && filterCountry !== "US" ? [filterCountry] : INTL_COUNTRIES;

  for (const countryId of countries) {
    let printedHeader = false;
    for (const era of eras) {
      const model = getCountryLayer1Model(countryId, era);
      if (!model) continue;

      if (!printedHeader) {
        console.log(`\n══ ${countryId} ═══════════════════════════════════════════════════`);
        printedHeader = true;
      }
      console.log(`\n── ${countryId} / ${era} ──`);
      console.log("  region | legacy econ  soc | new  econ  soc | Δ econ  soc | flags");

      const newDocs = buildModelRegionDemographics(model);
      const regionIds = newDocs.map((d) => d._id as string);
      const dbDocs = await sdColl.find({ _id: { $in: regionIds } }).toArray();
      const dbMap = new Map(dbDocs.map((d) => [d._id as string, d]));

      const results: RegionResult[] = [];
      for (const newSd of newDocs) {
        const newLean = stateLean(newSd, demographicCategories);
        const existing = dbMap.get(newSd._id as string);
        let legacyEcon: number | null = null;
        let legacySocial: number | null = null;
        if (existing) {
          const l = stateLean(existing, demographicCategories);
          legacyEcon = l.economicLean;
          legacySocial = l.socialLean;
        }
        const r: RegionResult = {
          id: newSd._id as string,
          legacyEcon,
          legacySocial,
          newEcon: newLean.economicLean,
          newSocial: newLean.socialLean,
          isNew: !existing,
        };
        results.push(r);
        printRow(r);
      }

      const s = printSectionSummary(`${countryId}/${era}`, results);
      grandFlips += s.flips;
      grandLarge += s.large;
      grandNew += s.newRegions;
      grandTotal += s.total;
    }
  }

  // ── Grand summary ─────────────────────────────────────────────────────────

  console.log("\n══ OVERALL SUMMARY ══════════════════════════════════════════════");
  console.log(`  Total regions checked : ${grandTotal}`);
  console.log(`  Sign flips            : ${grandFlips}`);
  console.log(`  Large shifts (>1pt)   : ${grandLarge}`);
  console.log(`  New (no current doc)  : ${grandNew}`);
  console.log(
    grandFlips === 0 && grandLarge === 0
      ? "\n  ✓ No flips or large shifts — safe to enable."
      : `\n  ⚠ Review flagged regions before enabling.`
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
