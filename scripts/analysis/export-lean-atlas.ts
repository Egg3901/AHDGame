/**
 * Export the lean atlas consumed by the GitHub Pages positions viewer
 * (tools/positions-atlas/). One JSON with:
 *  - anchors: per anchor era, per-state {econ, social, display} through the
 *    live seed path (`deriveRegionLeans`);
 *  - timeline: per year (2-year steps, 1953..2023), per-state leans blended
 *    between anchor eras with the same blend the substrate uses
 *    (`resolveEraBlend`). Leans are linear in positions, so lerping the
 *    derived anchor leans matches the position blend; census-share jumps at
 *    era boundaries are accepted viewer-grade approximation.
 *  - groupPositions: the authored era position tables for the drill-down pane.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/analysis/export-lean-atlas.ts <outfile>
 */
import { writeFileSync } from "node:fs";
import { deriveRegionLeans } from "@/lib/seeds/calibration/deriveRegionLeans";
import { getEraPositions } from "@/lib/seeds/demographicCategories";
import { resolveEraBlend, ERA_ANCHOR_YEARS } from "@/lib/seeds/eraInterpolation";
import type { EraId } from "@/lib/seeds/presetSelector";

const ERAS: EraId[] = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"];

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
  for (let year = 1953; year <= 2023; year += 2) {
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

  const atlas = {
    generatedFrom: "scripts/analysis/export-lean-atlas.ts",
    eras: ERAS,
    anchorYears: ERA_ANCHOR_YEARS,
    anchors,
    timeline,
    groupPositions,
  };
  writeFileSync(outfile, JSON.stringify(atlas));
  console.log(`wrote ${outfile}`);
}

main();
