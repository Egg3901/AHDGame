import { loadSubdivisionFile } from "@/lib/maps/subdivisionData";
import type { FieldOfficeScope } from "./rules";
import type { LiveStateLean } from "./liveLean";

/**
 * Where a county-scope office can stand, and how each spot leans.
 *
 * The geometry and baseline PVI come from the committed subdivision files
 * (`src/data/counties/{ST}.json`), with the lean swapped for the world's era
 * baseline (`src/data/county-leans`). Region scope has no subdivisions; offices
 * attach to the region itself.
 */

/** Data directory per scope. Add a scope here to give it a map. */
const SUBDIVISION_DATA_DIR: Partial<Record<FieldOfficeScope, string>> = {
  county: "counties",
};

export interface FieldOfficeSubdivision {
  id: string;
  name: string;
  path: string;
  electorate: number;
  /** Share of the region electorate, 0..1. */
  electorateShare: number;
  /** Era baseline PVI for this world (points, positive = right). */
  basePvi: number;
  /** Baseline shifted by the world's own last presidential result. */
  livePvi: number;
}

export interface FieldOfficeRegionMap {
  regionId: string;
  viewBox: string;
  subdivisions: FieldOfficeSubdivision[];
  regionBasePvi: number;
  regionLivePvi: number;
}

export async function loadFieldOfficeRegionMap(
  scope: FieldOfficeScope,
  regionId: string,
  live: LiveStateLean | null,
  preset: string | null
): Promise<FieldOfficeRegionMap | null> {
  const dir = SUBDIVISION_DATA_DIR[scope];
  // regionId feeds a filesystem path; only region-code shapes get through.
  if (!dir || !/^[A-Z]{2,3}$/.test(regionId)) return null;
  const file = await loadSubdivisionFile(dir, regionId, { preset });
  if (!file || file.subdivisions.length === 0) return null;

  const total = file.subdivisions.reduce((s, c) => s + (c.electorate || 0), 0);
  const regionBasePvi =
    total > 0
      ? file.subdivisions.reduce((s, c) => s + (c.leanScalar ?? 0) * (c.electorate || 0), 0) / total
      : 0;
  const regionLivePvi = live?.byState.get(regionId) ?? regionBasePvi;
  const shift = regionLivePvi - regionBasePvi;

  return {
    regionId,
    viewBox: file.viewBox,
    regionBasePvi: round1(regionBasePvi),
    regionLivePvi: round1(regionLivePvi),
    subdivisions: file.subdivisions.map((c) => ({
      id: c.id,
      name: c.name,
      path: c.path,
      electorate: c.electorate || 0,
      electorateShare: total > 0 ? (c.electorate || 0) / total : 0,
      basePvi: c.leanScalar ?? 0,
      livePvi: round1((c.leanScalar ?? 0) + shift),
    })),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
