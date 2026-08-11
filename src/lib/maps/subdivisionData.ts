// src/lib/maps/subdivisionData.ts
// Server-side loader for committed subdivision JSON. Normalizes per-country
// legacy shapes (US adapters arrive with Phases 2–3) to the generic shape.
import { readFile } from "fs/promises";
import { join } from "path";
import type { SubdivisionInput } from "@/lib/utils/subdivisionResults";

export interface SubdivisionFile {
  viewBox: string;
  subdivisions: (SubdivisionInput & { path: string })[];
}

/** Legacy US county file shape (src/data/counties/) — adapted at read time. */
interface LegacyCountyFile {
  viewBox: string;
  counties: { fips: string; name: string; path: string; population: number; cookPVI: number }[];
}

/** Legacy US CD file shape (src/data/congressional-districts/) — adapted at read time. */
interface LegacyCdFile {
  viewBox: string;
  districts: { cd: string; path: string; cookPVI: number }[];
}

export async function loadSubdivisionFile(
  dataDir: string,
  regionId: string
): Promise<SubdivisionFile | null> {
  try {
    const filePath = join(process.cwd(), "src", "data", ...dataDir.split("/"), `${regionId}.json`);
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as SubdivisionFile | LegacyCountyFile | LegacyCdFile;
    if ("counties" in parsed) {
      return {
        viewBox: parsed.viewBox,
        subdivisions: parsed.counties.map((c) => ({
          id: c.fips,
          name: c.name,
          path: c.path,
          electorate: c.population,
          leanScalar: c.cookPVI,
        })),
      };
    }
    if ("districts" in parsed) {
      return {
        viewBox: parsed.viewBox,
        subdivisions: parsed.districts.map((d) => ({
          id: d.cd,
          name: d.cd,
          path: d.path,
          electorate: 0,
          leanScalar: d.cookPVI,
        })),
      };
    }
    return parsed;
  } catch {
    return null;
  }
}
