"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { STATE_IDS } from "@/lib/constants/states";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { CDN_GEO } from "@/lib/images/cdnUrls";
import { CORPORATION_TYPES, CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { getStateSectorWeights } from "@/lib/seeds/reference/sectorSeedWeights";
import type { RegionMapData } from "@/components/RegionMapPaths";
import type { StateMapData } from "@/components/USAMapPaths";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

function MapSkeleton() {
  return <div className="h-[300px] animate-pulse rounded-lg bg-card-elevated" />;
}

const USAMapPaths = dynamic(
  () => import("@/components/USAMapPaths").then((m) => ({ default: m.USAMapPaths })),
  { ssr: false, loading: () => <MapSkeleton /> }
);
const UKMapPaths = dynamic(
  () => import("@/components/UKMapPaths").then((m) => ({ default: m.UKMapPaths })),
  { ssr: false, loading: () => <MapSkeleton /> }
);
const GermanyMapPaths = dynamic(
  () => import("@/components/GermanyMapPaths").then((m) => ({ default: m.GermanyMapPaths })),
  { ssr: false, loading: () => <MapSkeleton /> }
);
const JapanMapPaths = dynamic(
  () => import("@/components/JapanMapPaths").then((m) => ({ default: m.JapanMapPaths })),
  { ssr: false, loading: () => <MapSkeleton /> }
);
const RegionMapPaths = dynamic(
  () => import("@/components/RegionMapPaths").then((m) => ({ default: m.RegionMapPaths })),
  { ssr: false, loading: () => <MapSkeleton /> }
);

function USMapRenderer({ regionData }: { regionData: Record<string, RegionMapData> }) {
  return <USAMapPaths stateData={regionData as Record<string, StateMapData>} />;
}
function UKMapRenderer({ regionData }: { regionData: Record<string, RegionMapData> }) {
  return <UKMapPaths regionData={regionData} />;
}
function DEMapRenderer({ regionData }: { regionData: Record<string, RegionMapData> }) {
  return <GermanyMapPaths regionData={regionData} />;
}
function JPMapRenderer({ regionData }: { regionData: Record<string, RegionMapData> }) {
  return <JapanMapPaths regionData={regionData} />;
}
function CNMapRenderer({ regionData }: { regionData: Record<string, RegionMapData> }) {
  return (
    <RegionMapPaths geoUrl={CDN_GEO.cnRegions} width={480} height={340} regionData={regionData} />
  );
}
function IEMapRenderer({ regionData }: { regionData: Record<string, RegionMapData> }) {
  return (
    <RegionMapPaths geoUrl={CDN_GEO.ieRegions} width={300} height={400} regionData={regionData} />
  );
}
function BRMapRenderer({ regionData }: { regionData: Record<string, RegionMapData> }) {
  return (
    <RegionMapPaths geoUrl={CDN_GEO.brRegions} width={400} height={400} regionData={regionData} />
  );
}

type MapRendererComponent = ComponentType<{ regionData: Record<string, RegionMapData> }>;

const MAP_COMPONENTS: Partial<Record<CountryId, MapRendererComponent>> = {
  US: USMapRenderer,
  UK: UKMapRenderer,
  DE: DEMapRenderer,
  JP: JPMapRenderer,
  CN: CNMapRenderer,
  IE: IEMapRenderer,
  BR: BRMapRenderer,
};

const REGION_IDS: Partial<Record<CountryId, string[]>> = {
  US: [...STATE_IDS, "DC"],
  UK: ukRegions.map((r) => r._id),
  DE: deRegions.map((r) => r._id),
  JP: jpRegions.map((r) => r._id),
  CN: cnRegions.map((r) => r._id),
  IE: ieRegions.map((r) => r._id),
  BR: brRegions.map((r) => r._id),
};

const REGION_NAME_LOOKUP: Partial<Record<CountryId, Record<string, string>>> = {
  UK: Object.fromEntries(ukRegions.map((r) => [r._id, r.name])),
  DE: Object.fromEntries(deRegions.map((r) => [r._id, r.name])),
  JP: Object.fromEntries(jpRegions.map((r) => [r._id, r.name])),
  CN: Object.fromEntries(cnRegions.map((r) => [r._id, r.name])),
  IE: Object.fromEntries(ieRegions.map((r) => [r._id, r.name])),
  BR: Object.fromEntries(brRegions.map((r) => [r._id, r.name])),
};

function weightToColor(normalizedWeight: number): string {
  const lightness = Math.round(10 + normalizedWeight * 55);
  return `hsl(174, 60%, ${lightness}%)`;
}

const COUNTRIES: { id: CountryId; label: string }[] = [
  { id: "US", label: "US" },
  { id: "UK", label: "UK" },
  { id: "DE", label: "DE" },
  { id: "JP", label: "JP" },
  { id: "CN", label: "CN" },
  { id: "IE", label: "IE" },
  { id: "BR", label: "BR" },
];

export function SectorSeedMap() {
  const [country, setCountry] = useState<CountryId>("US");
  const [sector, setSector] = useState<CorporationType>("technology");

  const regionIds = useMemo(() => REGION_IDS[country] ?? [], [country]);

  // The wiki shows the STARTING seed picture and is not era-aware yet, so it
  // pins the default preset explicitly rather than riding a parameter default.
  // Making these widgets follow gameState.preset is tracked separately.
  const mapWeights = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of regionIds) {
      out[id] = getStateSectorWeights(id, country, DEFAULT_SEED_PRESET)[sector];
    }
    return out;
  }, [regionIds, country, sector]);

  const maxWeight = useMemo(() => Math.max(...Object.values(mapWeights), 0.001), [mapWeights]);

  const regionData = useMemo(() => {
    const nameLookup = REGION_NAME_LOOKUP[country] ?? {};
    const out: Record<string, RegionMapData> = {};
    for (const id of regionIds) {
      const w = mapWeights[id] ?? 0;
      const normalized = w / maxWeight;
      const name = nameLookup[id] ?? id;
      out[id] = {
        color: weightToColor(normalized),
        label: `${(w * 100).toFixed(1)}%`,
        tooltip: [name, `${(w * 100).toFixed(1)}% of sector seeding`],
      };
    }
    return out;
  }, [mapWeights, maxWeight, regionIds, country]);

  const MapComponent = MAP_COMPONENTS[country];

  return (
    <div className="my-4 rounded-xl border border-card-border bg-card/40 p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {COUNTRIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCountry(c.id)}
            className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
              country === c.id
                ? "bg-primary text-white"
                : "bg-card-elevated text-muted hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-3">
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value as CorporationType)}
          className="rounded border border-card-border bg-card px-2 py-1 text-sm text-foreground"
        >
          {CORPORATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {CORPORATION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-[300px]">
        {MapComponent ? (
          <MapComponent regionData={regionData} />
        ) : (
          <p className="text-sm text-muted">No map available for this country.</p>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">
        Darker = lower weight; brighter teal = higher sector seeding share.
      </p>
    </div>
  );
}
