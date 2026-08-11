"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import { SectionLabel } from "@/components/ui";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";
import { walRegions } from "@/lib/seeds/wal/walRegions";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";
import { ddRegions } from "@/lib/seeds/dd/ddRegions";
import { huRegions } from "@/lib/seeds/hu/huRegions";
import { plRegions } from "@/lib/seeds/pl/plRegions";
import { roRegions } from "@/lib/seeds/ro/roRegions";
import { yuRegions } from "@/lib/seeds/yu/yuRegions";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { blrRegions } from "@/lib/seeds/blr/blrRegions";
import { csRegions } from "@/lib/seeds/cs/csRegions";
import { balRegions } from "@/lib/seeds/bal/balRegions";
import type { State } from "@/lib/db/types";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import { sectorSpecializationMapEntry } from "./mapShared";
import { MapFallback } from "./MapFallback";
import { BRITISH_ISLES_GEO_URL } from "@/lib/maps/britishIslesGeometry";
import { RU_GEO_URL, RU_LABEL_OVERRIDES } from "@/lib/maps/ruGeometry";
import { TR_GEO_URL, TR_LABEL_OVERRIDES } from "@/lib/maps/trGeometry";
import { GR_GEO_URL, GR_LABEL_OVERRIDES } from "@/lib/maps/grGeometry";
import { AT_GEO_URL, AT_LABEL_OVERRIDES } from "@/lib/maps/atGeometry";
import { FI_GEO_URL, FI_LABEL_OVERRIDES } from "@/lib/maps/fiGeometry";
import { IT_GEO_URL, IT_LABEL_OVERRIDES } from "@/lib/maps/itGeometry";
import { FR_GEO_URL, FR_LABEL_OVERRIDES } from "@/lib/maps/frGeometry";
import { ES_GEO_URL, ES_LABEL_OVERRIDES } from "@/lib/maps/esGeometry";
import { SE_GEO_URL, SE_LABEL_OVERRIDES } from "@/lib/maps/seGeometry";
import { YU_GEO_URL, YU_LABEL_OVERRIDES } from "@/lib/maps/yuGeometry";
import { CS_GEO_URL, CS_LABEL_OVERRIDES } from "@/lib/maps/csGeometry";
import { BG_GEO_URL, BG_LABEL_OVERRIDES } from "@/lib/maps/bgGeometry";
import { HU_GEO_URL, HU_LABEL_OVERRIDES } from "@/lib/maps/huGeometry";
import { PL_GEO_URL, PL_LABEL_OVERRIDES } from "@/lib/maps/plGeometry";
import { RO_GEO_URL, RO_LABEL_OVERRIDES } from "@/lib/maps/roGeometry";
import { DD_LABEL_OVERRIDES } from "@/lib/maps/ddGeometry";
import { useRegionGeometry } from "@/lib/maps/useRegionGeometry";
import { DEVOLVED_REGION_CONTAINS } from "@/lib/maps/devolvedRegionContains";
import { useEnabledCountries } from "@/contexts/RegisteredCountriesContext";
import { CDN_GEO } from "@/lib/images/cdnUrls";

const RegionalGeoMap = dynamic(
  () => import("@/components/maps/RegionalGeoMap").then((m) => ({ default: m.RegionalGeoMap })),
  { loading: MapFallback, ssr: false }
);

type EconRegion = Pick<State, "_id" | "name" | "region" | "population" | "houseDistricts">;

const ECON_ONLY_REGIONS: Partial<Record<CountryId, EconRegion[]>> = {
  IE: ieRegions,
  SCO: scoRegions,
  WAL: walRegions,
  NG: ngRegions,
  // 1979 Cold-War roster — region grids (no per-country geojson geometry yet, so
  // these render as the region list/cards rather than a polygon map).
  RU: ruRegions,
  FR: frRegions,
  IT: itRegions,
  ES: esRegions,
  SE: seRegions,
  TR: trRegions,
  GR: grRegions,
  AT: atRegions,
  FI: fiRegions,
  DD: ddRegions,
  HU: huRegions,
  PL: plRegions,
  RO: roRegions,
  YU: yuRegions,
  BG: bgRegions,
  BLR: blrRegions,
  CS: csRegions,
  BAL: balRegions,
};

// Econ-only countries whose map is rendered from the shared British-Isles
// geometry, by live ownership (so a reunified region appears here).
const BRITISH_ISLES_ECON: Partial<Record<CountryId, boolean>> = { IE: true };

// Countries that render their OWN sub-region geometry rather than the shared
// British-Isles tile — the seceded nations (SCO/WAL) and Nigeria. Built from
// NUTS3 / admin boundaries — see scripts/build-country-geojson.ts.
const DEVOLVED_GEO_URL: Partial<Record<CountryId, string>> = {
  SCO: CDN_GEO.scoRegions,
  WAL: CDN_GEO.walRegions,
  NG: CDN_GEO.ngRegions,
  RU: RU_GEO_URL, // USSR's 17 macro-regions (1953 + 1979 presets) — local shard, not yet on CDN
  TR: TR_GEO_URL, // Turkey's 8 macro-regions — local shard, not yet on CDN
  GR: GR_GEO_URL, // Greece's 6 macro-regions — local shard, not yet on CDN
  AT: AT_GEO_URL, // Austria's 5 macro-regions — local shard, not yet on CDN
  FI: FI_GEO_URL, // Finland's 6 macro-regions — local shard, not yet on CDN
  IT: IT_GEO_URL, // Italy's 8 macro-regions — local shard, not yet on CDN
  FR: FR_GEO_URL, // France's 8 macro-regions — local shard, not yet on CDN
  ES: ES_GEO_URL, // Spain's 8 macro-regions — local shard, not yet on CDN
  SE: SE_GEO_URL, // Sweden's 8 macro-regions — local shard, not yet on CDN
  YU: YU_GEO_URL, // Yugoslavia's 8 federal units — local shard, not yet on CDN
  CS: CS_GEO_URL, // Czechoslovakia's 4 regions — local shard, not yet on CDN
  BG: BG_GEO_URL, // Bulgaria's 5 regions — local shard, not yet on CDN
  HU: HU_GEO_URL, // Hungary's 6 regions — local shard, not yet on CDN
  PL: PL_GEO_URL, // Poland's 8 macro-regions — local shard, not yet on CDN
  RO: RO_GEO_URL, // Romania's 7 historic provinces — local shard, not yet on CDN
};

// Compact map labels for countries whose region names overflow the tiles.
// Label position nudges for regions whose centroid lands unreadably — Spain's
// ES_CEN is a donut around Madrid, so its label is pushed south into La Mancha.
const DEVOLVED_LABEL_OFFSETS: Partial<Record<CountryId, Record<string, [number, number]>>> = {
  ES: { ES_CEN: [-8, 28] },
  // Capital enclaves pull their surrounding region's centroid label onto the
  // capital's own label — nudge the outer region's text into open space.
  HU: { HU_PES: [16, 12] },
  RO: { RO_MUN: [30, 2] },
  CS: { CS_BOH: [-14, 16] },
  AT: { AT_NOE: [-14, 16] },
};

const DEVOLVED_LABEL_OVERRIDES: Partial<Record<CountryId, Record<string, string>>> = {
  RU: RU_LABEL_OVERRIDES,
  TR: TR_LABEL_OVERRIDES,
  GR: GR_LABEL_OVERRIDES,
  AT: AT_LABEL_OVERRIDES,
  FI: FI_LABEL_OVERRIDES,
  IT: IT_LABEL_OVERRIDES,
  FR: FR_LABEL_OVERRIDES,
  ES: ES_LABEL_OVERRIDES,
  SE: SE_LABEL_OVERRIDES,
  YU: YU_LABEL_OVERRIDES,
  CS: CS_LABEL_OVERRIDES,
  BG: BG_LABEL_OVERRIDES,
  HU: HU_LABEL_OVERRIDES,
  PL: PL_LABEL_OVERRIDES,
  RO: RO_LABEL_OVERRIDES,
  // DD renders via the multi-area shard path (germany shard Länder + the
  // east-berlin BEO shard) — only the compact Berlin label is declared here.
  DD: DD_LABEL_OVERRIDES,
};

const ECON_REGION_GROUP_COLORS: Record<string, string> = {
  Leinster: "#4f7ac7",
  Munster: "#c7842a",
  Connacht: "#2a7c3e",
  Ulster: "#9b59b6",
  // SCO/WAL seed region groupings (scoRegions/walRegions `.region`).
  "Central Belt": "#4f7ac7",
  Highlands: "#2a7c3e",
  "North East": "#c7842a",
  East: "#5b8def",
  South: "#9b59b6",
  "South Wales": "#4f7ac7",
  "North Wales": "#2a7c3e",
  "Mid Wales": "#c7842a",
  // NG geopolitical zones.
  "North-West": "#1abc9c",
  "North-East": "#e74c3c",
  "North-Central": "#3498db",
  "South-West": "#9b59b6",
  "South-South": "#f1c40f",
  "South-East": "#e67e22",
  // GR seed `.region` groupings (grRegions/grRegions1953). "Macedonia" is
  // shared with YU (#f1c40f) and "Central" with SE (#9b59b6) — both stay
  // distinct from their GR neighbors; "Islands" reuses the IT key.
  Attica: "#e74c3c",
  Thessaly: "#c7842a",
  Peloponnese: "#2a7c3e",
  // AT seed `.region` groupings (atRegions/atRegions1953). "East" is shared
  // with SCO/WAL (#5b8def) and "South" with SCO/WAL (#9b59b6) — both stay
  // distinct from their AT neighbors (Vienna red, Danube teal, Alpine green).
  Vienna: "#e74c3c",
  Danube: "#1abc9c",
  "Alpine West": "#2a7c3e",
  // FI seed `.region` groupings (fiRegions/fiRegions1953). "Southwest" is
  // shared with FR (#9b59b6) and stays distinct from its FI neighbors
  // (Helsinki red, Lakeland teal, Karelia ochre, Bothnia blue, Arctic green).
  Helsinki: "#e74c3c",
  Lakeland: "#1abc9c",
  Karelia: "#c7842a",
  Bothnia: "#4f7ac7",
  "Arctic North": "#2a7c3e",
  // TR seed `.region` groupings (trRegions/trRegions1953).
  Marmara: "#4f7ac7",
  Aegean: "#1abc9c",
  Mediterranean: "#c7842a",
  "Black Sea": "#2a7c3e",
  "Central Anatolia": "#5b8def",
  "Eastern Anatolia": "#9b59b6",
  "Southeastern Anatolia": "#e67e22",
  // IT seed `.region` groupings (itRegions/itRegions1953). "South" is shared
  // with the SCO/WAL block above and keeps that color.
  North: "#4f7ac7",
  Center: "#c7842a",
  Islands: "#1abc9c",
  // FR seed `.region` groupings (frRegions/frRegions1953). "North"/"East"/
  // "Center"/"Mediterranean" reuse the shared keys above.
  "Île-de-France": "#e74c3c",
  West: "#2a7c3e",
  Southwest: "#9b59b6",
  "Rhône-Alpes": "#1abc9c",
  // ES seed `.region` groupings (esRegions/esRegions1953). "North"/"East"/
  // "South"/"Center" reuse the shared keys above.
  Madrid: "#e74c3c",
  Catalonia: "#1abc9c",
  Northwest: "#2a7c3e",
  // SE seed `.region` groupings (seRegions/seRegions1953). "West"/"South"/
  // "East"/"North" reuse the shared keys above.
  Stockholm: "#e74c3c",
  Southeast: "#c7842a",
  Central: "#9b59b6",
  // SE's "North-Central" shares the NG key above and keeps that color.
  // YU seed `.region` groupings (yuRegions/yuRegions1953) — one per federal
  // unit, colored so no two adjacent units share a hue.
  Slovenia: "#4f7ac7",
  Croatia: "#1abc9c",
  Bosnia: "#c7842a",
  Serbia: "#e74c3c",
  Vojvodina: "#5b8def",
  Kosovo: "#9b59b6",
  Montenegro: "#2a7c3e",
  Macedonia: "#f1c40f",
  // CS seed `.region` groupings (csRegions/csRegions1953) — Prague + one per
  // historic land.
  Prague: "#e74c3c",
  Bohemia: "#4f7ac7",
  Moravia: "#c7842a",
  Slovakia: "#2a7c3e",
  // BG seed `.region` groupings (bgRegions/bgRegions1953). "Black Sea" is
  // shared with TR (#2a7c3e) and "Southwest" with FR (#9b59b6) — both stay
  // distinct from their BG neighbors (Sofia red, Danubia blue, Thrace ochre).
  Sofia: "#e74c3c",
  "Danubian Plain": "#4f7ac7",
  Thrace: "#c7842a",
  // HU seed `.region` groupings (huRegions/huRegions1953). "Budapest" and
  // "Pest" get distinct hues from the surrounding Transdanubia/Plain bands.
  Budapest: "#e74c3c",
  Pest: "#5b8def",
  Transdanubia: "#4f7ac7",
  "Northern Hungary": "#2a7c3e",
  "Great Plain": "#c7842a",
  // PL seed `.region` groupings (plRegions/plRegions1953) — one per macro-region.
  Mazovia: "#e74c3c",
  Łódź: "#c7842a",
  "Lesser Poland": "#9b59b6",
  Silesia: "#5b8def",
  "Lower Silesia": "#1abc9c",
  "Greater Poland": "#2a7c3e",
  Pomerania: "#4f7ac7",
  "Eastern Poland": "#f1c40f",
  // RO seed `.region` groupings (roRegions/roRegions1953) — Bucharest + the
  // historic provinces (Muntenia+Oltenia share "Wallachia", Transylvania
  // proper + Banat share "Transylvania").
  Bucharest: "#e74c3c",
  Wallachia: "#c7842a",
  Transylvania: "#4f7ac7",
  Moldavia: "#2a7c3e",
  Dobruja: "#1abc9c",
};

export function EconOnlyMapPlaceholder({
  countryId,
  config,
  mapData,
  onRegionClick,
}: {
  countryId: CountryId;
  config: ReturnType<typeof getCountryConfig>;
  mapData: MapOverviewResponse | null;
  onRegionClick: (id: string) => void;
}) {
  const [mode, setMode] = useState<"regions" | "sectorBonuses">("regions");
  const seedRegions = useMemo(() => ECON_ONLY_REGIONS[countryId] ?? [], [countryId]);
  const isBritishIsles = BRITISH_ISLES_ECON[countryId] === true;
  const devolvedGeoUrl = DEVOLVED_GEO_URL[countryId];
  // A dedicated single-shard URL: the British-Isles tile (IE) or a seceded
  // nation's own geometry (SCO/WAL/NG). Listless countries have none.
  const geoUrl = isBritishIsles ? BRITISH_ISLES_GEO_URL : devolvedGeoUrl;
  const containsByRegion = DEVOLVED_REGION_CONTAINS[countryId];
  // Active countries (IE, seceded SCO/WAL) are playable — only a not-yet-enabled
  // country carries the econ-only label.
  const isEnabled = useEnabledCountries().includes(countryId);

  // Live roster from the overview (`states`-derived): the regions this country
  // owns NOW — so a reunified/seceded/transferred region joins or leaves, and a
  // country shows preset-correct population + seats, not a static seed. This
  // generalizes the former British-Isles-only live path to EVERY econ-only
  // country. Falls back to the seed only until the overview resolves.
  const displayRegions: EconRegion[] = useMemo(() => {
    if (!mapData?.regions?.length) return seedRegions;
    return mapData.regions.map((r): EconRegion => ({
      _id: r.id,
      name: r.name,
      region: r.grouping,
      population: r.population,
      houseDistricts: r.seats,
    }));
  }, [mapData, seedRegions]);

  // Multi-area geometry: a listless country (no dedicated `geoUrl`) that has
  // acquired regions which DO live in a manifest shard (e.g. France gaining
  // German Länder) renders them via the merged shard features. Owned regions
  // with no geometry anywhere stay list-only.
  const ownedCodes = useMemo(() => displayRegions.map((r) => r._id), [displayRegions]);
  const { features: multiAreaFeatures } = useRegionGeometry(geoUrl ? [] : ownedCodes);
  const hasMultiArea = !geoUrl && (multiAreaFeatures?.length ?? 0) > 0;
  const hasGeoMap = geoUrl != null || hasMultiArea;

  const regionData = useMemo(() => {
    const result: Record<string, { color: string; label: string; tooltip: string[] }> = {};
    for (const region of displayRegions) {
      if (mode === "sectorBonuses") {
        result[region._id] = sectorSpecializationMapEntry(region._id, region.name, mapData);
        continue;
      }
      const color = ECON_REGION_GROUP_COLORS[region.region ?? ""] ?? "#4f7ac7";
      const tooltip = [region.name];
      if (region.population > 0)
        tooltip.push(`${region.population.toLocaleString("en-US")} population`);
      if (region.houseDistricts > 0) tooltip.push(`${region.houseDistricts} seats`);
      result[region._id] = { color, label: region.name, tooltip };
    }
    return result;
  }, [displayRegions, mode, mapData]);

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-12">
        <div className="mb-4 flex items-center gap-3 sm:mb-6">
          <BackButton iconOnly />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
              {config.name} Map
            </h1>
            <p className="mt-0.5 text-xs text-muted sm:text-sm">
              {displayRegions.length} regions{isEnabled ? "" : " · Econ-only nation"}
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2 sm:mb-6">
          {[
            { id: "regions", label: "Regions" },
            { id: "sectorBonuses", label: "Sector Bonus" },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id as "regions" | "sectorBonuses")}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border bg-card text-muted hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
          {hasGeoMap && (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-card-border bg-card p-4 sm:p-6">
              <SectionLabel className="mb-4">Interactive Map</SectionLabel>
              <p className="-mt-2 mb-1 text-xs text-muted">
                Click a region to open it. Hover for population &amp; seat detail.
              </p>
              <div className="mx-auto min-h-[260px] w-full max-w-[min(100%,360px)]">
                <RegionalGeoMap
                  zoomable
                  sourceUrl={geoUrl}
                  features={hasMultiArea ? (multiAreaFeatures ?? undefined) : undefined}
                  regionCodes={ownedCodes}
                  regionData={regionData}
                  onRegionClick={onRegionClick}
                  labelOverrides={DEVOLVED_LABEL_OVERRIDES[countryId]}
                  labelOffsets={DEVOLVED_LABEL_OFFSETS[countryId]}
                />
              </div>
            </div>
          )}

          <div
            className={`rounded-xl border border-card-border bg-card p-6 ${
              hasGeoMap ? "lg:col-span-2" : "lg:col-span-3"
            }`}
          >
            <SectionLabel className="mb-4">All Regions</SectionLabel>
            <div className="space-y-1">
              {displayRegions.map((region) => {
                const d = regionData[region._id];
                return (
                  <button
                    key={region._id}
                    onClick={() => onRegionClick(region._id)}
                    className="group -mx-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-card-elevated/50"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: d?.color ?? "#334155" }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                        {region.name}
                      </div>
                      <div className="text-[10px] text-muted">
                        {region.population > 0
                          ? `${region.population.toLocaleString("en-US")} population`
                          : "Recently joined"}
                      </div>
                      {containsByRegion?.[region._id]?.length ? (
                        <div className="truncate text-[10px] text-muted/70">
                          Covers {containsByRegion[region._id].join(", ")}
                        </div>
                      ) : null}
                    </div>
                    {region.houseDistricts > 0 && (
                      <span className="shrink-0 text-xs text-muted">
                        {region.houseDistricts} seats
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-card-border/40 pt-4">
          <Link
            href={config.overviewPath}
            className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            ← {config.name} Overview
          </Link>
        </div>
      </main>
    </div>
  );
}
