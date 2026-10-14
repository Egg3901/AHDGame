/** Longitude interval in degrees, west edge first. East may exceed 180 when it crosses the dateline. */
export type LonInterval = [west: number, east: number];

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Center longitude of the shortest arc that covers every interval: the
 * complement of the widest empty gap. For the US, UK and Japan that centers
 * the map on the Americas so all three fit, where a Greenwich-centered map
 * spends half its width on empty ocean.
 */
export function framingLongitude(intervals: LonInterval[]): number {
  if (intervals.length === 0) return 0;
  const normalized = intervals
    .map(([west, east]) => {
      const start = wrapLon(west);
      let span = east - west;
      if (span < 0) span += 360;
      return [start, start + Math.min(span, 360)] as LonInterval;
    })
    .sort((a, b) => a[0] - b[0]);

  const merged: LonInterval[] = [];
  for (const [start, end] of normalized) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  let bestGap = -Infinity;
  let arcStart = merged[0][0];
  for (let i = 0; i < merged.length; i++) {
    const nextStart = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + 360;
    const gap = nextStart - merged[i][1];
    if (gap > bestGap) {
      bestGap = gap;
      arcStart = nextStart;
    }
  }
  if (bestGap <= 0) return 0;
  return wrapLon(arcStart + (360 - bestGap) / 2);
}

interface PolygonLike {
  type: string;
  coordinates: unknown;
}

/**
 * Splits a country into its polygons and drops the small outliers (the
 * Aleutians, Hawaii, overseas islets) whose bounds would otherwise stretch the
 * frame across the dateline.
 */
export function majorPolygons<T extends PolygonLike>(
  geometry: T | null | undefined,
  area: (polygon: PolygonLike) => number,
  minShare = 0.15
): PolygonLike[] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry];
  if (geometry.type !== "MultiPolygon" || !Array.isArray(geometry.coordinates)) return [];
  const polygons = (geometry.coordinates as unknown[]).map((coordinates) => ({
    type: "Polygon",
    coordinates,
  }));
  const areas = polygons.map(area);
  const max = Math.max(0, ...areas);
  return polygons.filter((_, i) => areas[i] >= max * minShare);
}
