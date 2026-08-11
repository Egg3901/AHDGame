"use client";

import { useEffect, useMemo, useState } from "react";
import { SVG_W, SVG_H, WORLD_GEO_URL } from "@/app/world/worldConstants";
import { isoNumericToCountryId } from "@/lib/constants/countryIso";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { REGION_SHARDS } from "@/lib/maps/regionManifest";
import { computeRegionBlobs } from "@/lib/maps/regionOverlay";
import { WORLD_OVERLAY_OWNER_FOLD } from "@/lib/maps/germanyGeometry";
import { VIETNAM_BASE_FEATURE_ID, VIETNAM_GEO_URL } from "@/lib/maps/vietnamGeometry";
import type { OrgSummary } from "../orgTypes";
import {
  memberFeatureIds as resolveMemberFeatureIds,
  memberEntityIds as resolveMemberEntityIds,
  orgMembersByCountry,
} from "./orgMembership";
import { OrgCountryCard } from "./OrgCountryCard";

/** Prefix marking an overlay blob's path key, so it can never collide with a feature id. */
const BLOB_PREFIX = "bi:";

/**
 * Flat (equal-area) world map for the IntOrg index. Pick an organization from the
 * selector to shade its member countries in the org's accent; click a country to
 * see which organizations it belongs to. Static projection — no globe/rotation.
 *
 * The base `countries-110m` features are the present-day world, which is the
 * wrong world for a Cold War game: it has no Soviet Union, no Czechoslovakia, no
 * Yugoslavia and no East Germany. So this map draws the same region overlay the
 * /world map and the situation boards draw — `computeRegionBlobs` unions each
 * shard's regions by their LIVE owner, and the base features an overlay now
 * covers are skipped. Nothing here is era-aware: a 1953 map shows the USSR
 * because the union republics are owned by RU in that world, and a 2019 map
 * shows Russia because they are not.
 */
export function OrgWorldMap({ orgs }: { orgs: OrgSummary[] }) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(orgs[0]?.id ?? null);
  const [paths, setPaths] = useState<Map<string, string | null>>(new Map());
  /** Overlay path key → the countryId whose regions it unions. */
  const [blobOwners, setBlobOwners] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    countryId: CountryId;
    position: { x: number; y: number };
  } | null>(null);

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId]
  );
  const byCountry = useMemo(() => orgMembersByCountry(orgs), [orgs]);
  const memberFeatureIds = useMemo(() => resolveMemberFeatureIds(selectedOrg), [selectedOrg]);
  const memberEntityIds = useMemo(() => resolveMemberEntityIds(selectedOrg), [selectedOrg]);

  useEffect(() => {
    let cancelled = false;

    /**
     * The region overlay, or null if any part of it is unavailable. Best-effort
     * by design and separated from the base map for that reason: a failed shard
     * fetch must leave a present-day map standing rather than no map at all.
     */
    async function loadOverlay() {
      try {
        // A shard whose regions don't union cleanly keeps its base polygon, and
        // the East Berlin shard is nation-map only (the BE→BB fold covers Berlin
        // on a world map).
        const shards = REGION_SHARDS.filter((s) => s.worldOverlay !== false);
        const [pcMod, ownResp, shardGeos] = await Promise.all([
          import("polygon-clipping"),
          fetch("/api/maps/region-ownership", { cache: "no-store" }).then((r) => r.json()),
          Promise.all(shards.map((s) => fetch(s.url, { cache: "no-store" }).then((r) => r.json()))),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pc: any = (pcMod as any).default ?? pcMod;
        return computeRegionBlobs(
          shards.map((s, i) => ({
            baseCountryIds: s.baseCountryIds,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            features: (shardGeos[i] as any)?.features ?? [],
          })),
          ownResp?.ownership ?? {},
          WORLD_OVERLAY_OWNER_FOLD,
          pc,
          // Single-owner shards included, exactly as the /world map does. Without
          // it the USSR would never draw: every one of its regions belongs to RU,
          // so the shard has one owner and a splits-only overlay skips it.
          true
        );
      } catch {
        return null;
      }
    }

    async function load() {
      try {
        const [d3, topojson] = await Promise.all([import("d3-geo"), import("topojson-client")]);
        // The overlay resolves alongside the basemap rather than after it: paths
        // are computed once, so the map never flashes Russia before the USSR.
        const [resp, overlay] = await Promise.all([fetch(WORLD_GEO_URL), loadOverlay()]);
        if (!resp.ok) throw new Error(`geo ${resp.status}`);
        const topo = await resp.json();
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const geojson = (topojson as any).feature(topo, topo.objects.countries);

        // The two Vietnams, same as the /world globe. Latent rather than visible
        // today — neither is in an organisation — but the accession phase can
        // admit a non-player nation on its own, and without this the member
        // would simply not shade. The basemap's unified 704 goes with them: it
        // is not a country in 1953 and would sit under both halves.
        try {
          const vnResp = await fetch(VIETNAM_GEO_URL, { cache: "no-store" });
          if (vnResp.ok) {
            const vn = await vnResp.json();
            if (vn?.features?.length) {
              geojson.features = geojson.features.filter(
                (f: { id?: unknown }) => String(f.id) !== VIETNAM_BASE_FEATURE_ID
              );
              geojson.features.push(...vn.features);
            }
          }
        } catch {
          // Best-effort: without it Vietnam draws as one unified outline.
        }
        const proj = d3.geoEqualEarth().fitSize([SVG_W, SVG_H], { type: "Sphere" });
        const pathGen = d3.geoPath(proj);
        const next = new Map<string, string | null>();
        const covered = overlay?.coveredBases ?? new Set<string>();

        for (const f of geojson.features) {
          const id = String(f.id);
          // A covered base is drawn by a blob now. Matched by feature id, by game
          // countryId, or by NAME for the features Natural Earth ships without an
          // id (Kosovo, under the yugoslavia shard) — the same three-way check
          // the /world map makes, and only while an overlay actually covers it.
          const name = f.properties?.name as string | undefined;
          const countryId = isoNumericToCountryId(id);
          if (covered.has(id)) continue;
          if (countryId && covered.has(countryId)) continue;
          if (name && covered.has(name)) continue;
          next.set(id, pathGen(f));
        }

        const owners = new Map<string, string>();
        for (const [owner, solidCW] of overlay?.blobs ?? []) {
          const coordinates = solidCW.map((poly) =>
            poly.map((ring) => {
              // The soviet-union shard is authored with unwrapped Far-East
              // longitudes (past the antimeridian) so it unions cleanly in a
              // continuous space; d3 needs them back inside −180..180.
              const wrapped = ring.map(([lon, lat]) => [lon > 180 ? lon - 360 : lon, lat]);
              // Orient each ring so its spherical interior is the SMALLER region,
              // or d3 fills the rest of the world instead of the country.
              return d3.geoArea({ type: "Polygon", coordinates: [wrapped] }) > 2 * Math.PI
                ? [...wrapped].reverse()
                : wrapped;
            })
          );
          const key = `${BLOB_PREFIX}${owner}`;
          const d = pathGen({
            type: "Feature",
            properties: {},
            geometry: { type: "MultiPolygon", coordinates },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
          if (!d) continue;
          next.set(key, d);
          owners.set(key, owner);
        }

        setBlobOwners(owners);
        setPaths(next);
        setLoaded(true);
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (orgs.length === 0) {
    return (
      <section className="rounded-xl border border-card-border bg-card p-8 text-center text-sm text-muted">
        No organizations to map.
      </section>
    );
  }

  /**
   * The country a path stands for: a blob's live owner, or the base feature's
   * own mapping. Undefined for territory the game does not model as a country,
   * which is what keeps the country card from opening on something that has no
   * config behind it. A blob owner is checked against `COUNTRY_CONFIGS` rather
   * than trusted, since it arrives from live region ownership.
   */
  function countryIdFor(key: string): CountryId | undefined {
    const owner = blobOwners.get(key);
    if (owner) return owner in COUNTRY_CONFIGS ? (owner as CountryId) : undefined;
    return isoNumericToCountryId(key);
  }

  function fillFor(key: string): { fill: string; interactive: boolean } {
    const owner = blobOwners.get(key);
    const countryId = countryIdFor(key);
    // Membership is resolved by map feature for base polygons and by OWNER for
    // overlay blobs: an entity-wide roster includes background nations that have
    // geometry but no CountryId, and a blob is identified by the country holding
    // its regions rather than by any ISO code. Non-modelled members still shade;
    // they stay non-interactive, since the country card behind a click only
    // exists for modelled countries.
    const isMember = owner ? memberEntityIds.has(owner) : memberFeatureIds.has(key);
    if (isMember && selectedOrg) {
      return { fill: selectedOrg.identity.accent, interactive: countryId != null };
    }
    if (!countryId) return { fill: "var(--card-elevated)", interactive: false };
    if (hovered === key) return { fill: "var(--primary)", interactive: true };
    return { fill: "var(--card-border)", interactive: true };
  }

  function onCountryClick(key: string, e: React.MouseEvent<SVGPathElement>) {
    const countryId = countryIdFor(key);
    if (!countryId) return;
    const rect = (
      e.currentTarget.ownerSVGElement?.parentElement as HTMLElement | null
    )?.getBoundingClientRect();
    const position = rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: e.clientX, y: e.clientY };
    setSelected({ countryId, position });
  }

  return (
    <section className="space-y-3">
      {/* Selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {orgs.map((org) => {
          const active = org.id === selectedOrgId;
          return (
            <button
              key={org.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setSelectedOrgId(org.id);
                setSelected(null);
              }}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-card-border bg-card text-muted hover:text-foreground"
              }`}
            >
              {org.def.shortName}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      {selectedOrg && (
        <div className="flex items-center gap-4 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: selectedOrg.identity.accent }}
            />
            Members of {selectedOrg.def.name}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-[var(--card-border)]" />
            Other countries
          </span>
        </div>
      )}

      {/* Map (overflow-visible so the country card isn't clipped at the edges) */}
      <div className="relative overflow-visible rounded-xl border border-card-border bg-card shadow-card">
        {error ? (
          <div
            className="flex w-full items-center justify-center text-sm text-muted"
            style={{ aspectRatio: `${SVG_W}/${SVG_H}` }}
          >
            Map unavailable.
          </div>
        ) : !loaded ? (
          <div
            className="flex w-full items-center justify-center text-sm text-muted"
            style={{ aspectRatio: `${SVG_W}/${SVG_H}` }}
          >
            Loading map…
          </div>
        ) : (
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="block w-full">
            {[...paths.entries()].map(([id, d]) => {
              if (!d) return null;
              const { fill, interactive } = fillFor(id);
              return (
                <path
                  key={id}
                  d={d}
                  fill={fill}
                  stroke="var(--card-border)"
                  strokeWidth={0.5}
                  style={{
                    cursor: interactive ? "pointer" : "default",
                    transition: "fill 0.15s ease",
                  }}
                  onMouseEnter={() => interactive && setHovered(id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={(e) => interactive && onCountryClick(id, e)}
                />
              );
            })}
          </svg>
        )}

        {selected && (
          <OrgCountryCard
            countryId={selected.countryId}
            orgs={byCountry.get(selected.countryId) ?? []}
            position={selected.position}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </section>
  );
}
