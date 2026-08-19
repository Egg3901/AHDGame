/**
 * Export the atlas consumed by the GitHub Pages positions viewer
 * (tools/positions-atlas/). One JSON with:
 *  - anchors: per anchor era, per-state {econ, social, display} through the
 *    live seed path (`deriveRegionLeans`);
 *  - timeline: per year (yearly, 1953..2023), per-state leans blended between
 *    anchor eras with the same blend the substrate uses (`resolveEraBlend`).
 *    Leans are linear in positions, so lerping the derived anchor leans
 *    matches the position blend; census-share jumps at era boundaries are
 *    accepted viewer-grade approximation.
 *  - groupPositions: authored era-wide position tables;
 *  - statePositions: per era, per state, the RESOLVED position table after
 *    state overrides (only states that differ from the era-wide table);
 *  - census: per era, per state, the raw census marginals (race, age,
 *    education, wealth, ideology shares);
 *  - turnoutRates: per era baseline turnout by bucket;
 *  - checkpoints: the era checkpoint definitions (window, pacing, targets);
 *  - sources: repo paths each view should link to.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/analysis/export-lean-atlas.ts <outfile>
 */
import { writeFileSync } from "node:fs";
import { deriveRegionLeans } from "@/lib/seeds/calibration/deriveRegionLeans";
import { getEraPositions, ERA_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import { resolveEraBlend, ERA_ANCHOR_YEARS } from "@/lib/seeds/eraInterpolation";
import { ERA_CHECKPOINTS } from "@/lib/demographics/eraCheckpoints";
import type { EraId } from "@/lib/seeds/presetSelector";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { stateCensusData1979 } from "@/lib/seeds/stateCensusData1979";
import { stateCensusData1991 } from "@/lib/seeds/stateCensusData1991";
import { stateCensusData1999 } from "@/lib/seeds/stateCensusData1999";
import { stateCensusData2007 } from "@/lib/seeds/stateCensusData2007";
import { stateCensusData } from "@/lib/seeds/stateCensusData";
import { stateCensusData2023 } from "@/lib/seeds/stateCensusData2023";

const ERAS: EraId[] = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"];

const CENSUS: Record<string, Record<string, unknown>> = {
  "1953": stateCensusData1953,
  "1979": stateCensusData1979,
  "1991": stateCensusData1991,
  "1999": stateCensusData1999,
  "2007": stateCensusData2007,
  "2019": stateCensusData,
  "2023": stateCensusData2023,
};

const CENSUS_SOURCE: Record<string, string> = {
  "1953": "src/lib/seeds/stateCensusData1953.ts",
  "1979": "src/lib/seeds/stateCensusData1979.ts",
  "1991": "src/lib/seeds/stateCensusData1991.ts",
  "1999": "src/lib/seeds/stateCensusData1999.ts",
  "2007": "src/lib/seeds/stateCensusData2007.ts",
  "2019": "src/lib/seeds/stateCensusData.ts",
  "2023": "src/lib/seeds/stateCensusData2023.ts",
};

type LeanRow = { economic: number; social: number; display: number };

function anchorMap(era: EraId): Record<string, LeanRow> {
  return Object.fromEntries(
    deriveRegionLeans("US", era).map((l) => [
      l.regionId,
      { economic: l.economic, social: l.social, display: l.display },
    ])
  );
}

function main() {
  const outfile = process.argv[2] ?? "tools/positions-atlas/lean-atlas.json";
  const anchors = Object.fromEntries(ERAS.map((e) => [e, anchorMap(e)]));

  const timeline: Record<string, Record<string, LeanRow>> = {};
  for (let year = 1953; year <= 2023; year += 1) {
    const { lo, hi, t } = resolveEraBlend(year);
    const a = anchors[lo];
    const b = anchors[hi];
    const states = new Set([...Object.keys(a), ...Object.keys(b)]);
    const rows: Record<string, LeanRow> = {};
    for (const s of states) {
      const ra = a[s] ?? b[s];
      const rb = b[s] ?? a[s];
      rows[s] = {
        economic: ra.economic + (rb.economic - ra.economic) * t,
        social: ra.social + (rb.social - ra.social) * t,
        display: ra.display + (rb.display - ra.display) * t,
      };
    }
    timeline[String(year)] = rows;
  }

  const groupPositions = Object.fromEntries(ERAS.map((e) => [e, getEraPositions(e)]));

  // Per-state resolved positions: only keep states whose resolved table
  // differs from the era-wide one, keyed by the (dim,bucket) cells that differ.
  const statePositions: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const era of ERAS) {
    const base = getEraPositions(era) as Record<
      string,
      Record<string, { economicLean: number; socialLean: number }>
    >;
    const perState: Record<string, Record<string, unknown>> = {};
    for (const stateId of Object.keys(CENSUS[era] ?? {})) {
      const resolved = getEraPositions(era, stateId) as typeof base;
      const diff: Record<string, { economicLean: number; socialLean: number }> = {};
      for (const dim of Object.keys(resolved)) {
        for (const bucket of Object.keys(resolved[dim] ?? {})) {
          const r = resolved[dim][bucket];
          const b = base[dim]?.[bucket];
          if (!b || r.economicLean !== b.economicLean || r.socialLean !== b.socialLean) {
            diff[`${dim}:${bucket}`] = r;
          }
        }
      }
      if (Object.keys(diff).length > 0) perState[stateId] = diff;
    }
    statePositions[era] = perState;
  }

  const checkpoints = ERA_CHECKPOINTS.map((c) => ({
    id: c.id,
    title: c.title,
    trigger: c.triggerCaseKey ?? null,
    fallbackStartTurn: c.fallbackStartTurn,
    durationTurns: c.durationTurns,
    historicalWindow: c.historicalWindow ?? null,
    targets: c.targets,
  }));

  const atlas = {
    generatedFrom: "scripts/analysis/export-lean-atlas.ts",
    repo: "https://github.com/Egg3901/AHDGame",
    eras: ERAS,
    anchorYears: ERA_ANCHOR_YEARS,
    anchors,
    timeline,
    groupPositions,
    statePositions,
    census: CENSUS,
    turnoutRates: ERA_TURNOUT_RATES,
    checkpoints,
    sources: {
      leans: [
        "src/lib/seeds/demographicCategories.ts",
        "src/lib/seeds/regionalPositions.ts",
        "src/lib/seeds/calibration/deriveRegionLeans.ts",
      ],
      census: CENSUS_SOURCE,
      checkpoints: ["src/lib/demographics/eraCheckpoints.ts"],
      engine: [
        "src/lib/demographics/granularElectorate.ts",
        "src/lib/demographics/cachedStateLean.ts",
        "src/lib/seeds/eraPositionsForYear.ts",
      ],
      exporter: "scripts/analysis/export-lean-atlas.ts",
    },
  };
  writeFileSync(outfile, JSON.stringify(atlas));
  console.log(`wrote ${outfile}`);
}

main();
