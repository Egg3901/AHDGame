"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import { getCountryConfig } from "@/lib/constants/countries";
import { STATE_IDS } from "@/lib/constants/states";
import { EXTRACTABLE_RESOURCES, COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import {
  type LeanAxis,
  interpolateGreen,
  leanAxisValue,
  leanHalfRange,
  sectorSpecializationMapEntry,
} from "./mapShared";
import { interpolateLeanHex } from "@/lib/utils/politics";
import { LeanMapLegend } from "./LeanMapLegend";
import { StateLeanPanel } from "./StateLeanPanel";
import { MapFallback } from "./MapFallback";
import { useResourceMapData } from "./useResourceMapData";
import { useFreightDemandData } from "./useFreightDemandData";
import {
  FREIGHT_HAUL_LOAD_MODE_DESCRIPTION,
  freightHaulLoadCaption,
  freightHaulLoadLabel,
  freightHaulLoadTooltip,
} from "./freightHaulLoadCopy";

import { USA_GEO_URL, US_REGION_CODES, US_LABEL_OVERRIDES } from "@/lib/maps/usaGeometry";

const RegionalGeoMap = dynamic(
  () => import("@/components/maps/RegionalGeoMap").then((m) => ({ default: m.RegionalGeoMap })),
  { loading: MapFallback, ssr: false }
);

type USMapMode =
  | "partyOrg"
  | "senate"
  | "house"
  | "governor"
  | "approval"
  | "lean"
  | "presidential"
  | "resources"
  | "sectorBonuses"
  | "logistics";

const US_MODE_CONFIG: { id: USMapMode; label: string; description: string }[] = [
  { id: "partyOrg", label: "Party Org", description: "Leading party organization per state" },
  { id: "senate", label: "Senate", description: "Two senators per state (split view)" },
  { id: "house", label: "House", description: "House delegation leader by seats" },
  { id: "governor", label: "Governor", description: "Governor's party" },
  { id: "approval", label: "Approval", description: "Government approval heatmap" },
  { id: "lean", label: "Lean", description: "Economic or social lean (toggle below)" },
  {
    id: "presidential",
    label: "Presidential",
    description: "Electoral votes by leading candidate",
  },
  { id: "resources", label: "Resources", description: "Extractable resource capacity by state" },
  {
    id: "sectorBonuses",
    label: "Sector Bonus",
    description: "Primary sector profit margin bonus by state",
  },
  {
    id: "logistics",
    label: "Logistics",
    description: FREIGHT_HAUL_LOAD_MODE_DESCRIPTION,
  },
];

// Fallback when the server didn't supply a colour for a candidate (matches the
// map's own `partyColor` fallback so the bar and map stay visually consistent).
const CANDIDATE_BAR_FALLBACK = "#8B5CF6";

function PresidentialResultsPanel({
  electoralVotes,
  candidateNames,
  candidateColors,
  totalElectoralVotes,
}: {
  electoralVotes: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateColors: Record<string, string>;
  totalElectoralVotes?: number;
}) {
  const sorted = Object.entries(electoralVotes)
    .filter(([, ev]) => ev > 0)
    .sort(([, a], [, b]) => b - a);

  // State-set-driven: the total comes from the live apportionment (538 for the
  // current 50-state set; fewer in an earlier era). A bare majority wins.
  const totalEV = totalElectoralVotes && totalElectoralVotes > 0 ? totalElectoralVotes : 538;
  const evNeeded = Math.floor(totalEV / 2) + 1;

  return (
    <div className="mt-6 rounded-xl border border-card-border bg-card p-4 sm:p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-base sm:text-lg font-semibold">Presidential Results</h3>
        <span className="text-xs sm:text-sm text-muted">
          {totalEV} votes · {evNeeded} to win
        </span>
      </div>

      <div className="space-y-4">
        {/* Unified distribution bar */}
        <div className="relative h-10 sm:h-12 rounded-lg overflow-hidden border border-card-border bg-background flex">
          {sorted.map(([candidateId, ev]) => {
            const pct = (ev / totalEV) * 100;
            const color = candidateColors[candidateId] ?? CANDIDATE_BAR_FALLBACK;
            if (pct === 0) return null;
            return (
              <div
                key={candidateId}
                className="h-full flex items-center justify-center relative group"
                style={{ width: `${pct}%`, backgroundColor: color }}
              >
                {pct > 8 && <span className="text-white font-bold text-sm tabular-nums">{ev}</span>}
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
              </div>
            );
          })}

          {/* Majority (to-win) marker — position and label both derive from the
              live electoral-college total. */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground/40 pointer-events-none"
            style={{ left: `${(evNeeded / totalEV) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-foreground/60 whitespace-nowrap">
              {evNeeded}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {sorted.map(([candidateId, ev]) => {
            const name = candidateNames[candidateId] ?? "Unknown";
            const color = candidateColors[candidateId] ?? CANDIDATE_BAR_FALLBACK;
            const isWinner = ev >= evNeeded && sorted[0]?.[0] === candidateId;

            return (
              <div key={candidateId} className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                <span className="text-sm font-semibold">{name}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>
                  {ev}
                </span>
                {isWinner && <span className="text-yellow-400 text-sm">★</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function USMapWithModes({
  mapData,
  config,
  onRegionClick,
}: {
  mapData: MapOverviewResponse | null;
  config: ReturnType<typeof getCountryConfig>;
  onRegionClick: (id: string) => void;
}) {
  const [mode, setMode] = useState<USMapMode>("house");
  const [leanAxis, setLeanAxis] = useState<LeanAxis>("display");
  // State whose demographic breakdown is open (lean mode click; null = closed).
  const [leanDetailId, setLeanDetailId] = useState<string | null>(null);
  const [resourceType, setResourceType] = useState<ExtractableResource>("oil");
  const [resourceToggle, setResourceToggle] = useState<
    "capacity" | "contractedPct" | "openAccessPct"
  >("capacity");

  const resourceData = useResourceMapData(mode, config.id, resourceType);
  const freightData = useFreightDemandData(mode, config.id);

  const { stateData, senateSplitData, senateSplitMode } = useMemo(() => {
    const stateData: Record<string, { color: string; label?: string; tooltip?: string[] }> = {};
    let senateSplitData:
      | Record<
          string,
          {
            seat1Color: string;
            seat2Color: string;
            seat1Label: string;
            seat2Label: string;
            seat1Tooltip?: string;
            seat2Tooltip?: string;
          }
        >
      | undefined;
    let senateSplitMode = false;

    if (mode === "resources") {
      const maxCap = Math.max(...Object.values(resourceData).map((e) => e.capacity), 1);
      for (const [stateId, entry] of Object.entries(resourceData)) {
        const value = entry[resourceToggle];
        const normalized = resourceToggle === "capacity" ? value / maxCap : value;
        stateData[stateId] = {
          color: entry.capacity === 0 ? "#374151" : interpolateGreen(normalized),
          label:
            resourceToggle === "capacity"
              ? `${value.toLocaleString("en-US")} units/turn`
              : `${(value * 100).toFixed(1)}%`,
        };
      }
      return { stateData, senateSplitData: undefined, senateSplitMode: false };
    }

    if (mode === "logistics") {
      // Color by freight capacity (market size logistics clear against). Haul
      // alone understates states that mostly serve local / free intra-state trade.
      const maxCapacity = Math.max(
        ...Object.values(freightData.states).map((e) => e.capacity ?? e.total),
        1
      );
      for (const [stateId, entry] of Object.entries(freightData.states)) {
        const capacity = entry.capacity ?? 0;
        const intensity = capacity > 0 ? capacity : entry.total;
        stateData[stateId] = {
          color:
            intensity > 0
              ? interpolateGreen(intensity / maxCapacity)
              : entry.openMarket > 0
                ? "#c7842a"
                : "#374151",
          label: freightHaulLoadLabel(entry),
          tooltip: freightHaulLoadTooltip(stateId, entry),
        };
      }
      return { stateData, senateSplitData: undefined, senateSplitMode: false };
    }

    const partyOrg = mapData?.partyOrg ?? {};
    const senate = mapData?.senate ?? {};
    const house = mapData?.house ?? {};
    const governor = mapData?.governor ?? {};
    const approval = mapData?.approval ?? {};
    const lean = mapData?.lean ?? {};
    const presidential = mapData?.presidential ?? {};

    // Prefer the live political roster from /api/map/overview so unadmitted
    // territories (AK/HI in 1953) and DC are not painted as vacant states.
    // Fall back to the modern 50 only while the overview is still loading.
    const rosterIds =
      mapData?.regions && mapData.regions.length > 0
        ? mapData.regions.map((r) => r.id)
        : [...STATE_IDS];
    const allStateIds = new Set([
      ...rosterIds,
      ...Object.keys(partyOrg),
      ...Object.keys(house),
      ...Object.keys(governor),
      ...Object.keys(approval),
      ...Object.keys(lean),
      ...Object.keys(presidential),
    ]);

    if (mode === "sectorBonuses") {
      for (const stateId of allStateIds) {
        stateData[stateId] = sectorSpecializationMapEntry(stateId, stateId, mapData);
      }
    } else if (mode === "partyOrg") {
      for (const stateId of allStateIds) {
        const d = partyOrg[stateId];
        if (d) {
          stateData[stateId] = { color: d.leadColor, label: d.leadingParty, tooltip: d.tooltip };
        } else {
          stateData[stateId] = {
            color: "#334155",
            label: stateId,
            tooltip: [stateId, "No party org"],
          };
        }
      }
    } else if (mode === "senate") {
      senateSplitMode = true;
      senateSplitData = {};
      for (const stateId of allStateIds) {
        const s = senate[stateId];
        if (s?.seat1 || s?.seat2) {
          senateSplitData[stateId] = {
            seat1Color: s.seat1?.color ?? "#334155",
            seat2Color: s.seat2?.color ?? "#334155",
            seat1Label: s.seat1?.name ?? "Vacant",
            seat2Label: s.seat2?.name ?? "Vacant",
            seat1Tooltip: s.seat1 ? `${s.seat1.party}: ${s.seat1.name}` : undefined,
            seat2Tooltip: s.seat2 ? `${s.seat2.party}: ${s.seat2.name}` : undefined,
          };
        }
        stateData[stateId] =
          s?.seat1 || s?.seat2
            ? { color: "#334155", label: stateId, tooltip: [stateId, "Senate split view"] }
            : { color: "#334155", label: stateId, tooltip: [stateId, "No senators"] };
      }
    } else if (mode === "house") {
      for (const stateId of allStateIds) {
        const d = house[stateId];
        if (d) {
          stateData[stateId] = {
            color: d.leadColor,
            label: `${d.seats}/${d.total}`,
            tooltip: d.tooltip,
          };
        } else {
          stateData[stateId] = {
            color: "#334155",
            label: stateId,
            tooltip: [stateId, "No seats filled"],
          };
        }
      }
    } else if (mode === "governor") {
      for (const stateId of allStateIds) {
        const d = governor[stateId];
        if (d) {
          stateData[stateId] = { color: d.leadColor, label: d.governorName, tooltip: d.tooltip };
        } else {
          stateData[stateId] = {
            color: "#334155",
            label: stateId,
            tooltip: [stateId, "No governor"],
          };
        }
      }
    } else if (mode === "approval") {
      for (const stateId of allStateIds) {
        const d = approval[stateId];
        if (d) {
          stateData[stateId] = {
            color: d.color,
            label: `${d.approval.toFixed(0)}%`,
            tooltip: d.tooltip,
          };
        } else {
          stateData[stateId] = {
            color: "#334155",
            label: stateId,
            tooltip: [stateId, "No approval data"],
          };
        }
      }
    } else if (mode === "lean") {
      // Continuous fills fitted to the current national spread; the bucketed
      // server colours flatten compressed leans into one centre shade.
      const halfRange = leanHalfRange(lean, leanAxis);
      for (const stateId of allStateIds) {
        const d = lean[stateId];
        if (d) {
          const color = interpolateLeanHex(
            leanAxisValue(d, leanAxis),
            leanAxis === "social" ? "social" : "economic",
            halfRange
          );
          const label =
            leanAxis === "economic"
              ? (d.economicLabel ?? d.label)
              : leanAxis === "social"
                ? (d.socialLabel ?? d.label)
                : d.label;
          stateData[stateId] = { color, label, tooltip: d.tooltip };
        } else {
          stateData[stateId] = {
            color: "#334155",
            label: stateId,
            tooltip: [stateId, "No lean data"],
          };
        }
      }
    } else if (mode === "presidential") {
      for (const stateId of allStateIds) {
        const d = presidential[stateId];
        if (d) {
          stateData[stateId] = { color: d.leadColor, label: `${d.ev} EV`, tooltip: d.tooltip };
        } else {
          stateData[stateId] = {
            color: "#334155",
            label: stateId,
            tooltip: [stateId, "No results"],
          };
        }
      }
    }

    return { stateData, senateSplitData, senateSplitMode };
  }, [mapData, mode, leanAxis, resourceData, resourceToggle, freightData]);

  const modeConfig = US_MODE_CONFIG.find((m) => m.id === mode);

  // Live political roster — earlier eras with fewer states (48 under 1953)
  // render correctly. Falls back to the modern 50 while the overview loads.
  const liveUSCodes =
    mapData?.regions && mapData.regions.length > 0
      ? mapData.regions.map((r) => r.id)
      : [...US_REGION_CODES];

  // Adapt the Senate two-seat split to RegionalGeoMap's splitData shape.
  const splitData = senateSplitData
    ? Object.fromEntries(
        Object.entries(senateSplitData).map(([id, s]) => [
          id,
          {
            color1: s.seat1Color,
            color2: s.seat2Color,
            label1: s.seat1Label,
            label2: s.seat2Label,
            tooltip1: s.seat1Tooltip,
            tooltip2: s.seat2Tooltip,
          },
        ])
      )
    : undefined;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-12">
        <div className="mb-4 sm:mb-6 flex items-center gap-3">
          <BackButton iconOnly />
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
              {config.name} Map
            </h1>
            <p className="mt-0.5 text-xs sm:text-sm text-muted">{modeConfig?.description}</p>
          </div>
        </div>

        <div className="mb-4 sm:mb-6 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-2 min-w-max sm:flex-wrap sm:min-w-0 pb-1">
            {US_MODE_CONFIG.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setLeanDetailId(null);
                }}
                className={`shrink-0 rounded-lg border px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium transition-colors ${
                  mode === m.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-card-border bg-card text-muted hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === "resources" && (
            <div className="mt-3 flex flex-wrap gap-3">
              <div className="flex flex-wrap gap-1">
                {EXTRACTABLE_RESOURCES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setResourceType(r)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      resourceType === r
                        ? "bg-primary text-white"
                        : "bg-card-elevated text-muted hover:text-foreground"
                    }`}
                  >
                    {COMMODITY_LABELS[r]}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(["capacity", "contractedPct", "openAccessPct"] as const).map((tog) => (
                  <button
                    key={tog}
                    onClick={() => setResourceToggle(tog)}
                    className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                      resourceToggle === tog
                        ? "bg-primary text-white"
                        : "bg-card-elevated text-muted hover:text-foreground"
                    }`}
                  >
                    {tog === "capacity"
                      ? "Capacity"
                      : tog === "contractedPct"
                        ? "Contracted %"
                        : "Open-access %"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === "logistics" && (
            <p className="mt-3 text-xs text-muted">
              {freightHaulLoadCaption(Object.keys(freightData.states).length > 0)}
            </p>
          )}
        </div>

        {/* Outside the horizontally-scrolling mode-chip strip: on mobile the
            strip scrolls to reach "Lean", which pushed this toggle off-screen. */}
        {mode === "lean" && (
          <div className="-mt-2 mb-4 flex gap-2 sm:-mt-4 sm:mb-6">
            {(["display", "economic", "social"] as const).map((ax) => (
              <button
                key={ax}
                onClick={() => setLeanAxis(ax)}
                className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                  leanAxis === ax
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-card-border bg-card text-muted hover:text-foreground"
                }`}
              >
                {ax === "display" ? "Combined" : ax === "economic" ? "Economic" : "Social"}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-card-border bg-card p-4 sm:p-6">
          <div
            className="w-full rounded-lg bg-background p-2 overflow-hidden"
            style={{ aspectRatio: "960/600", minHeight: 320 }}
          >
            <RegionalGeoMap
              sourceUrl={USA_GEO_URL}
              regionCodes={liveUSCodes}
              regionData={stateData}
              labelOverrides={US_LABEL_OVERRIDES}
              projection="geoAlbersUsa"
              projectionConfig={{ scale: 1000 }}
              width={800}
              height={600}
              zoomable
              splitMode={senateSplitMode}
              splitData={splitData}
              onRegionClick={(id) => (mode === "lean" ? setLeanDetailId(id) : onRegionClick(id))}
            />
          </div>
          {mode === "lean" && mapData?.lean && (
            <LeanMapLegend axis={leanAxis} halfRange={leanHalfRange(mapData.lean, leanAxis)} />
          )}
        </div>

        {mode === "lean" && leanDetailId && (
          <StateLeanPanel
            key={leanDetailId}
            countryCode={config.id}
            stateId={leanDetailId}
            onClose={() => setLeanDetailId(null)}
          />
        )}

        {mode === "presidential" && mapData?.presidentialElectoralVotes && (
          <PresidentialResultsPanel
            electoralVotes={mapData.presidentialElectoralVotes}
            candidateNames={mapData.presidentialCandidateNames ?? {}}
            candidateColors={mapData.presidentialCandidateColors ?? {}}
            totalElectoralVotes={mapData.totalElectoralVotes}
          />
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-card-border/40">
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
