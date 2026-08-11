// Shared core of the world-map region overlay: group a shard's regions by their
// live owner and union each owner's regions into ONE solid blob (in lon/lat), so a
// nation reads as a single merged shape — not a mosaic of region polygons. Both the
// main /world map (d3 globe + flat) and the Cold War situation boards (baked
// equirectangular SVG) consume this; they differ only in how they PROJECT and
// render the returned blobs, and in the inclusion policy (`"structural"` on
// /world keeps multi-base silhouettes; Cold War boards overlay clean splits
// only). Pure — no React, no fetch.

type Ring = number[][];
type Poly = Ring[];
type MultiPoly = Poly[];

/** Minimal region/country feature shape this overlay reads. */
export interface RegionOverlayFeature {
  properties?: { regionCode?: string } | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

/** A geometry shard paired with the base countries it occupies (from the manifest). */
export interface RegionOverlayShard {
  baseCountryIds: readonly string[];
  features: RegionOverlayFeature[];
}

export interface RegionOverlayResult {
  /** ownerCountryId → solid (outer-ring-only, CW) MultiPolygon in lon/lat. */
  blobs: Map<string, MultiPoly>;
  /** countries-110m country ids an overlay now draws — hide their base polygon. */
  coveredBases: Set<string>;
}

const toMP = (geom: RegionOverlayFeature["geometry"]): MultiPoly =>
  geom?.type === "Polygon"
    ? [geom.coordinates as Poly]
    : geom?.type === "MultiPolygon"
      ? (geom.coordinates as MultiPoly)
      : [];

/**
 * Which single-owner shards still produce an overlay blob.
 *
 * - `false` — splits only (Cold War boards). A unified country keeps its
 *   countries-110m base polygon.
 * - `true` — every fully-owned shard, including single-homeland detail
 *   (USA/France/…). Too heavy for the spinning /world globe.
 * - `"structural"` — splits, PLUS single-owner shards that cover more than one
 *   base feature (USSR, Yugoslavia, Czechoslovakia, Baltics, …). Those overlays
 *   change the political silhouette; coastline-detail shards do not.
 */
export type RegionOverlayInclusion = boolean | "structural";

/**
 * Compute the per-owner overlay blobs for the given shards + live ownership.
 *
 * Each fully-owned shard's regions are grouped by owner (after the `fold`, e.g. West
 * Berlin → Brandenburg) and unioned into ONE solid blob per owner; the shard's base
 * country/countries are marked covered. By default a single-owner (unified) shard is
 * SKIPPED — the Cold War boards only ever overlay clean splits, and a unified country
 * keeps its base polygon there. Pass `includeSingleOwner: true` to union every
 * unified country (detailed coastlines), or `"structural"` for the /world map —
 * multi-base silhouettes without the per-frame cost of every homeland shard.
 *
 * If `fuseHomelandGeometry` is supplied, an acquirer's OWN base homeland polygon is
 * unioned into its blob (France + acquired Länder = one nation) and that base is also
 * marked covered. Omit it to keep base homelands separate (same-colour adjacency is
 * enough on a choropleth, and avoids fusing a sprawling homeland).
 */
export function computeRegionBlobs(
  shards: RegionOverlayShard[],
  ownership: Record<string, string>,
  fold: Record<string, string>,
  polygonClipping: { union: (poly: Poly, ...rest: Poly[]) => MultiPoly },
  includeSingleOwner: RegionOverlayInclusion = false,
  fuseHomelandGeometry?: (ownerId: string) => RegionOverlayFeature["geometry"] | undefined
): RegionOverlayResult {
  const byOwner = new Map<string, MultiPoly>();
  const ownerOf = (f: RegionOverlayFeature): string | undefined => {
    const code = f.properties?.regionCode;
    return code ? ownership[fold[code] ?? code] : undefined;
  };
  const coveredBases = new Set<string>();

  for (const shard of shards) {
    const feats = shard.features ?? [];
    if (!feats.length) continue;
    // Fully-owned gate: skip a partially-owned source (its base polygon stands in).
    if (!feats.every((f) => f.properties?.regionCode && ownership[f.properties.regionCode])) {
      continue;
    }
    // Split-only by default. `true` keeps every unified homeland blob;
    // `"structural"` keeps only multi-base silhouettes (see RegionOverlayInclusion).
    const shardOwners = new Set(feats.map(ownerOf));
    if (shardOwners.size < 2) {
      if (includeSingleOwner === true) {
        // keep
      } else if (includeSingleOwner === "structural" && shard.baseCountryIds.length > 1) {
        // keep — e.g. USSR covering RU + union-republic base features
      } else {
        continue;
      }
    }
    for (const f of feats) {
      const owner = ownerOf(f);
      if (!owner) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      const dst = byOwner.get(owner)!;
      for (const poly of toMP(f.geometry)) dst.push(poly);
    }
    for (const bc of shard.baseCountryIds) coveredBases.add(bc);
  }

  if (fuseHomelandGeometry) {
    for (const owner of [...byOwner.keys()]) {
      if (coveredBases.has(owner)) continue;
      const geom = fuseHomelandGeometry(owner);
      if (!geom) continue;
      for (const poly of toMP(geom)) byOwner.get(owner)!.push(poly);
      coveredBases.add(owner);
    }
  }

  const blobs = new Map<string, MultiPoly>();
  for (const [owner, polys] of byOwner) {
    if (!polys.length) continue;
    const unioned = polygonClipping.union(polys[0], ...polys.slice(1));
    // Keep only outer rings (drop holes/gaps from independently-digitized borders);
    // reverse to CW so d3 fills the interior as land (polygon-clipping emits CCW).
    blobs.set(
      owner,
      unioned.map((poly) => [[...poly[0]].reverse()])
    );
  }
  return { blobs, coveredBases };
}

/**
 * Which manifest shards the /world globe should download under structural mode.
 *
 * Multi-base silhouettes always qualify. Single-homeland shards only qualify when
 * live ownership shows a split (2+ owners) — otherwise they stay on countries-110m
 * and we avoid fetching megabytes of coastline GeoJSON on first open.
 */
export function selectStructuralOverlayShards<
  T extends { baseCountryIds: readonly string[]; codes: readonly string[] },
>(shards: readonly T[], ownership: Record<string, string>): T[] {
  return shards.filter((s) => {
    if (s.baseCountryIds.length > 1) return true;
    const owners = new Set<string>();
    for (const code of s.codes) {
      const owner = ownership[code];
      if (owner) owners.add(owner);
    }
    return owners.size >= 2;
  });
}
