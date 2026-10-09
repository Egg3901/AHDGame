// src/lib/maps/countyLeans.ts
// Era-specific county lean baselines. Server-only (reads committed JSON).
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * County PVI baselines by era (`src/data/county-leans/{era}.json`, fips →
 * points, positive = right). Each era is built from the two presidential
 * elections before its start year, weighted 75/25 the way Cook weights them,
 * so a 1991 world starts from the 1988 and 1984 county map rather than
 * today's. Build script: `scripts/geo/build-county-leans.py`.
 */
export const COUNTY_LEAN_ERAS = [
  1953, 1968, 1979, 1991, 1999, 2007, 2019, 2020, 2023, 2027,
] as const;

/**
 * Era for a world preset ("1991-default" → 1991): the latest era at or before
 * the preset's start year, else the earliest. Unknown or missing presets get
 * the newest era, which matches the `cookPVI` committed in the county files.
 */
export function countyLeanEraForPreset(preset: string | null | undefined): number {
  const year = Number(/^(\d{4})/.exec(preset ?? "")?.[1]);
  if (!Number.isFinite(year)) return COUNTY_LEAN_ERAS[COUNTY_LEAN_ERAS.length - 1];
  let era: number = COUNTY_LEAN_ERAS[0];
  for (const e of COUNTY_LEAN_ERAS) if (e <= year) era = e;
  return era;
}

/** Elections each era's baseline is built from, for display. */
const ERA_SOURCE: Record<number, string> = {
  1953: "1948 and 1952 presidential results",
  1968: "1960 and 1964 presidential results",
  1979: "1972 and 1976 presidential results",
  1991: "1984 and 1988 presidential results",
  1999: "1992 and 1996 presidential results",
  2007: "2000 and 2004 presidential results",
  2019: "2012 and 2016 presidential results",
  2020: "2012 and 2016 presidential results",
  2023: "2016 and 2020 presidential results",
  2027: "2020 and 2024 presidential results, adjusted by the 2025 governor races",
};

export function countyLeanSourceLabel(preset: string | null | undefined): string {
  return ERA_SOURCE[countyLeanEraForPreset(preset)] ?? "recent presidential results";
}

const cache = new Map<number, Promise<Record<string, number> | null>>();

export function loadCountyLeans(
  preset: string | null | undefined
): Promise<Record<string, number> | null> {
  const era = countyLeanEraForPreset(preset);
  let pending = cache.get(era);
  if (!pending) {
    pending = readFile(join(process.cwd(), "src", "data", "county-leans", `${era}.json`), "utf-8")
      .then((raw) => JSON.parse(raw) as Record<string, number>)
      .catch(() => null);
    cache.set(era, pending);
  }
  return pending;
}
