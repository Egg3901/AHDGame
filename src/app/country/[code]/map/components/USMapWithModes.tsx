"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { AtlasTooltip, AtlasInspector, AtlasBreakdown } from "./AtlasPanels";
import { ATLAS_STORAGE_KEY, readAtlasPreferences, type AtlasView } from "./atlasModel";
import styles from "./atlas.module.css";
import Link from "next/link";
import BackButton from "@/components/BackButton";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
  | "population"
  | "representation"
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
  const t = useTranslations("elections.atlas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<AtlasView>("atlas");
  const [showLabels, setShowLabels] = useState(true);
  const [showCharts, setShowCharts] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "population" | "seats" | "approval">("name");
  const [descending, setDescending] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    try {
      const saved = readAtlasPreferences(localStorage.getItem(ATLAS_STORAGE_KEY));
      setView(saved.view);
      setShowLabels(saved.labels);
      setShowCharts(saved.charts);
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
    setPreferencesReady(true);
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    try {
      localStorage.setItem(
        ATLAS_STORAGE_KEY,
        JSON.stringify({ view, labels: showLabels, charts: showCharts })
      );
    } catch {
      /* Preferences remain usable without storage. */
    }
  }, [preferencesReady, view, showLabels, showCharts]);
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

    if (mode === "population" || mode === "representation") {
      const regions = mapData?.regions ?? [];
      const max = Math.max(
        ...regions.map((r) => (mode === "population" ? r.population : r.seats)),
        1
      );
      for (const r of regions) {
        const value = mode === "population" ? r.population : r.seats;
        stateData[r.id] = {
          color: interpolateGreen(value / max),
          label: value.toLocaleString("en-US"),
          tooltip: [
            r.name,
            `${value.toLocaleString("en-US")} ${mode === "population" ? t("people") : t("seats")}`,
          ],
        };
      }
      return { stateData, senateSplitData: undefined, senateSplitMode: false };
    }
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
    const rosterIds = mapData?.regions ? mapData.regions.map((r) => r.id) : [...STATE_IDS];
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
          stateData[stateId] = {
            color: d.leadColor,
            label: d.leadingPartyName ?? d.leadingParty,
            tooltip: d.tooltip,
          };
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
            ? {
                color: "#334155",
                label: `${s.seat1?.name ?? t("vacant")} / ${s.seat2?.name ?? t("vacant")}`,
                tooltip: [stateId, "Senate split view"],
              }
            : { color: "#334155", label: stateId, tooltip: [stateId, "No senators"] };
      }
    } else if (mode === "house") {
      for (const stateId of allStateIds) {
        const d = house[stateId];
        if (d) {
          stateData[stateId] = {
            color: d.leadColor,
            label: d.tooltip[0] ?? `${d.seats}/${d.total}`,
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
  }, [mapData, mode, leanAxis, resourceData, resourceToggle, freightData, t]);

  // Live political roster — earlier eras with fewer states (48 under 1953)
  // render correctly. Falls back to the modern 50 while the overview loads.
  const liveUSCodes = mapData?.regions ? mapData.regions.map((r) => r.id) : [...US_REGION_CODES];

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

  const regions = (mapData?.regions ?? [])
    .filter((r) => `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const value =
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "approval"
            ? (mapData?.approval[a.id]?.approval ?? -1) - (mapData?.approval[b.id]?.approval ?? -1)
            : a[sort] - b[sort];
      return descending ? -value : value;
    });
  const selectRegion = (id: string) => {
    setSelectedId(id);
    setLeanDetailId(mode === "lean" ? id : null);
  };
  const sortBy = (key: typeof sort) => {
    if (sort === key) setDescending(!descending);
    else {
      setSort(key);
      setDescending(key !== "name");
    }
  };

  return (
    <div className={styles.atlas}>
      <main className={styles.main}>
        <header className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BackButton iconOnly />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {t("pageTitle", { country: config.name })}
            </h1>
          </div>
          <Link
            href={config.overviewPath}
            className="text-body-sm text-muted hover:text-foreground"
          >
            {t("overview")}
          </Link>
        </header>
        <div className={styles.toolbar}>
          <label className="flex items-center gap-2 text-body-sm text-muted">
            <span>{t("layer")}</span>
            <select
              className={styles.layerSelect}
              value={mode}
              aria-label={t("layer")}
              onChange={(e) => {
                const next = e.target.value as USMapMode;
                setMode(next);
                setLeanDetailId(next === "lean" ? selectedId : null);
              }}
            >
              {(
                [
                  {
                    label: "politics",
                    modes: ["house", "senate", "governor", "presidential", "partyOrg"],
                  },
                  { label: "society", modes: ["approval", "lean", "population", "representation"] },
                  { label: "economy", modes: ["resources", "sectorBonuses", "logistics"] },
                ] as const
              ).map((group) => (
                <optgroup key={group.label} label={t(group.label)}>
                  {group.modes.map((id) => (
                    <option key={id} value={id}>
                      {t(id)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className={styles.segment} aria-label={t("view")}>
            <Button
              variant={view !== "table" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={view !== "table"}
              onClick={() => setView(view === "focus" ? "focus" : "atlas")}
            >
              {t("atlas")}
            </Button>
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              {t("table")}
            </Button>
          </div>
          <Input
            className="!w-full sm:!w-52 !py-2 !text-body-sm"
            type="search"
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <details
            className={styles.displayMenu}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary>{t("display")}</summary>
            <div className={styles.display}>
              <label>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                />
                {t("labels")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showCharts}
                  onChange={(e) => setShowCharts(e.target.checked)}
                />
                {t("charts")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={view === "focus"}
                  onChange={(e) => setView(e.target.checked ? "focus" : "atlas")}
                />
                {t("focus")}
              </label>
            </div>
          </details>
        </div>
        {mode === "resources" && (
          <div className="mb-4 flex flex-wrap gap-3">
            <select
              className={styles.search}
              aria-label={t("resources")}
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value as ExtractableResource)}
            >
              {EXTRACTABLE_RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {COMMODITY_LABELS[r]}
                </option>
              ))}
            </select>
            <div className={styles.segment}>
              {(["capacity", "contractedPct", "openAccessPct"] as const).map((tog) => (
                <button
                  key={tog}
                  aria-pressed={resourceToggle === tog}
                  onClick={() => setResourceToggle(tog)}
                >
                  {t(tog)}
                </button>
              ))}
            </div>
          </div>
        )}
        {mode === "lean" && (
          <div className="mb-4">
            <div className={styles.segment}>
              {(["display", "economic", "social"] as const).map((ax) => (
                <button key={ax} aria-pressed={leanAxis === ax} onClick={() => setLeanAxis(ax)}>
                  {t(ax === "display" ? "combined" : ax)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className={`${styles.workspace} ${view === "focus" ? styles.focus : ""}`}>
          <div className="min-w-0">
            <Card padding="none" className="min-w-0">
              <div className="border-b border-card-border px-4 py-3 text-body-sm text-muted">
                {t(`description.${mode}`)}
              </div>
              {view === "table" ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {(["name", "population", "seats", "approval"] as const).map((key) => (
                          <th
                            key={key}
                            aria-sort={
                              sort === key ? (descending ? "descending" : "ascending") : "none"
                            }
                          >
                            <button onClick={() => sortBy(key)}>
                              {t(
                                key === "name" ? "state" : key === "seats" ? "representation" : key
                              )}{" "}
                              {sort === key ? (descending ? "↓" : "↑") : "↕"}
                            </button>
                          </th>
                        ))}
                        <th>{t("layerValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regions.map((r) => (
                        <tr key={r.id} aria-selected={selectedId === r.id}>
                          <td>
                            <button onClick={() => selectRegion(r.id)}>
                              <span
                                className={styles.dot}
                                style={{ background: stateData[r.id]?.color }}
                              />{" "}
                              {r.name}
                            </button>
                          </td>
                          <td>{r.population.toLocaleString("en-US")}</td>
                          <td>{r.seats}</td>
                          <td>
                            {mapData?.approval[r.id]
                              ? `${mapData.approval[r.id].approval.toFixed(1)}%`
                              : t("noData")}
                          </td>
                          <td>{stateData[r.id]?.label ?? t("noData")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!regions.length && <p className="p-6 text-sm text-muted">{t("noResults")}</p>}
                </div>
              ) : (
                <>
                  <div className={styles.mapStage}>
                    <RegionalGeoMap
                      sourceUrl={USA_GEO_URL}
                      regionCodes={liveUSCodes}
                      regionData={stateData}
                      labelOverrides={US_LABEL_OVERRIDES}
                      projection="geoAlbersUsa"
                      projectionConfig={{ scale: 1000 }}
                      width={960}
                      height={600}
                      zoomable
                      zoom={zoom}
                      onZoomChange={setZoom}
                      resetKey={resetKey}
                      showLabels={showLabels}
                      splitMode={senateSplitMode}
                      splitData={splitData}
                      highlightColor="var(--primary)"
                      highlightedRegions={
                        selectedId ? [selectedId] : search ? regions.map((r) => r.id) : []
                      }
                      renderTooltip={(id) => (
                        <AtlasTooltip id={id} data={mapData} cell={stateData[id]} mode={mode} />
                      )}
                      onRegionClick={selectRegion}
                    />
                  </div>
                  <div className={styles.mapFooter}>
                    <span>
                      {selectedId ? (
                        <a
                          className="text-foreground underline underline-offset-4"
                          href="#us-atlas-inspector"
                        >
                          {t("inspect")}: {selectedId} ↓
                        </a>
                      ) : (
                        t("mapHint")
                      )}
                    </span>
                    <div className={styles.zoomControls}>
                      <button
                        className={styles.iconButton}
                        aria-label={t("zoomOut")}
                        onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
                      >
                        −
                      </button>
                      <span className="w-10 text-center font-mono">{zoom.toFixed(1)}×</span>
                      <button
                        className={styles.iconButton}
                        aria-label={t("zoomIn")}
                        onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
                      >
                        +
                      </button>
                      <button
                        className="ml-2 text-xs"
                        onClick={() => {
                          setZoom(1);
                          setResetKey((k) => k + 1);
                        }}
                      >
                        {t("reset")}
                      </button>
                    </div>
                  </div>
                  {search && (
                    <div className={styles.regionList} aria-label={t("allStates")}>
                      {regions.map((r) => (
                        <button
                          key={r.id}
                          aria-pressed={selectedId === r.id}
                          onClick={() => selectRegion(r.id)}
                          title={r.name}
                        >
                          {search ? r.name : r.id}
                        </button>
                      ))}
                      {!regions.length && <p className="text-xs text-muted">{t("noResults")}</p>}
                    </div>
                  )}
                </>
              )}
              {mode === "lean" && mapData?.lean && (
                <div className="px-5 pb-4">
                  <LeanMapLegend
                    axis={leanAxis}
                    halfRange={leanHalfRange(mapData.lean, leanAxis)}
                  />
                </div>
              )}
              {mode === "logistics" && (
                <p className="px-5 pb-4 text-xs text-muted">
                  {freightHaulLoadCaption(Object.keys(freightData.states).length > 0)}
                </p>
              )}
            </Card>
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
          </div>
          {mapData && (view !== "focus" || selectedId) && (
            <aside id="us-atlas-inspector" className={styles.sidebar} aria-label={t("inspect")}>
              <AtlasInspector
                id={selectedId}
                data={mapData}
                cells={stateData}
                mode={mode}
                onOpen={onRegionClick}
                onClear={() => {
                  setSelectedId(null);
                  setLeanDetailId(null);
                }}
              />
              {showCharts && (
                <AtlasBreakdown
                  data={mapData}
                  mode={mode}
                  cells={stateData}
                  values={
                    mode === "resources"
                      ? Object.fromEntries(
                          Object.entries(resourceData).map(([id, entry]) => [
                            id,
                            resourceToggle === "capacity"
                              ? entry.capacity
                              : entry[resourceToggle] * 100,
                          ])
                        )
                      : mode === "logistics"
                        ? Object.fromEntries(
                            Object.entries(freightData.states).map(([id, entry]) => [
                              id,
                              entry.capacity ?? entry.total,
                            ])
                          )
                        : undefined
                  }
                  valueUnit={
                    mode === "resources"
                      ? resourceToggle === "capacity"
                        ? t("unitsPerTurn")
                        : "%"
                      : t("freightUnits")
                  }
                />
              )}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
