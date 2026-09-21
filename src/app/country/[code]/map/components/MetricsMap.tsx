"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import type { MapMetricsResponse, MapMetricDefinition } from "@/lib/map/metricTypes";
import type { MapOverviewResponse } from "@/lib/map/overviewTypes";
import { USA_GEO_URL, US_REGION_CODES, US_LABEL_OVERRIDES } from "@/lib/maps/usaGeometry";
import { OfficeholderCard } from "./AtlasPanels";
import { MapFallback } from "./MapFallback";
import {
  formatMapMetric,
  metricExtent,
  metricRatio,
  metricColor,
  metricDistribution,
} from "./metricMapModel";
import styles from "./atlas.module.css";

const RegionalGeoMap = dynamic(
  () => import("@/components/maps/RegionalGeoMap").then((m) => ({ default: m.RegionalGeoMap })),
  { ssr: false, loading: MapFallback }
);
const PREFERENCE_KEY = "ahd-us-metric-map-v1";
const CATEGORIES = [
  "economy",
  "population",
  "education",
  "health",
  "infrastructure",
  "order",
  "environment",
  "society",
  "governance",
  "defense",
] as const;
const POPULAR = [
  "gdp",
  "gdpPerCapita",
  "macro.economic.unemploymentRate",
  "macro.economic.medianIncome",
  "macro.economic.gdpGrowth",
  "population",
];

export function MetricsMap({
  mapData,
  onOpen,
}: {
  mapData: MapOverviewResponse | null;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("elections.atlas");
  const m = useTranslations("elections.atlas.metricsView");
  const [data, setData] = useState<MapMetricsResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [metricId, setMetricId] = useState("gdp");
  const [category, setCategory] = useState("all");
  const [metricSearch, setMetricSearch] = useState("");
  const [stateSearch, setStateSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState("");
  const [table, setTable] = useState(false);
  const [labels, setLabels] = useState(true);
  const [valueLabels, setValueLabels] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [sort, setSort] = useState<"name" | "value">("value");
  const [descending, setDescending] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/map/metrics?countryId=US", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("metrics");
        return response.json() as Promise<MapMetricsResponse>;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setData(payload);
        try {
          const saved = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "null");
          if (payload.definitions.some((d) => d.id === saved?.metricId))
            setMetricId(saved.metricId);
          else if (!payload.definitions.some((d) => d.id === "gdp") && payload.definitions[0])
            setMetricId(payload.definitions[0].id);
        } catch {
          /* Optional local preference. */
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  const chooseMetric = (id: string) => {
    setMetricId(id);
    try {
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ metricId: id }));
    } catch {
      /* Optional local preference. */
    }
  };
  const definition = data?.definitions.find((d) => d.id === metricId);
  const roster = mapData?.regions ?? [];
  const rows = roster.map((r) => ({ ...r, value: data?.states[r.id]?.[metricId] }));
  const measured = rows.filter(
    (r): r is typeof r & { value: number } => r.value != null && Number.isFinite(r.value)
  );
  const extent = metricExtent(measured.map((r) => r.value));
  const format = (value: number | undefined, compact = false) =>
    definition && value != null ? formatMapMetric(value, definition, compact) : t("noData");
  const color = (value: number | undefined) =>
    value == null || !extent ? "var(--card-border)" : metricColor(value, extent.min, extent.max);
  const rank = (value: number) => measured.filter((r) => r.value > value).length + 1;
  const selectedRow = rows.find((r) => r.id === selected);
  const comparedRow = rows.find((r) => r.id === compare);
  const catalog =
    data?.definitions.filter(
      (d) =>
        (category === "all" || d.category === category) &&
        `${d.name} ${d.description}`.toLowerCase().includes(metricSearch.toLowerCase())
    ) ?? [];
  const visibleRows = rows
    .filter((r) => `${r.id} ${r.name}`.toLowerCase().includes(stateSearch.toLowerCase()))
    .sort((a, b) => {
      if (sort === "name") return (descending ? -1 : 1) * a.name.localeCompare(b.name);
      if (a.value == null) return b.value == null ? a.name.localeCompare(b.name) : 1;
      if (b.value == null) return -1;
      return (descending ? -1 : 1) * (a.value - b.value) || a.name.localeCompare(b.name);
    });
  const sortBy = (key: typeof sort) => {
    if (sort === key) setDescending(!descending);
    else {
      setSort(key);
      setDescending(key === "value");
    }
  };
  const cells = Object.fromEntries(
    rows.map((r) => [r.id, { color: color(r.value), label: format(r.value) }])
  );
  const valueOverrides = Object.fromEntries(
    rows.map((r) => [r.id, valueLabels && definition ? `${r.id} ${format(r.value, true)}` : r.id])
  );
  const bins = extent
    ? metricDistribution(
        measured.map((r) => r.value),
        extent.min,
        extent.max
      )
    : [];
  const maxBin = Math.max(...bins, 1);
  if (error)
    return (
      <Card>
        <p role="alert">{m("loadError")}</p>
        <Button
          className="mt-3"
          onClick={() => {
            setError(false);
            setAttempt((a) => a + 1);
          }}
        >
          {m("retry")}
        </Button>
      </Card>
    );
  if (!data)
    return (
      <Card>
        <p role="status" className="text-muted">
          {m("loading")}
        </p>
      </Card>
    );
  if (!definition)
    return (
      <Card>
        <p>{m("empty")}</p>
      </Card>
    );
  const sourceLabel = (d: MapMetricDefinition) => m(d.source === "score" ? "score" : "measured");
  return (
    <>
      <details className={styles.metricPicker}>
        <summary>
          <span className="text-muted">{m("choose")}</span>
          <strong>{definition.name}</strong>
          <span className="ml-auto text-muted">{m("browse")}</span>
        </summary>
        <div className="border-t border-card-border p-4">
          <Input
            type="search"
            aria-label={m("searchMetrics")}
            placeholder={m("searchMetrics")}
            value={metricSearch}
            onChange={(e) => setMetricSearch(e.target.value)}
          />
          <div className="my-3 flex flex-wrap gap-2" aria-label={m("categories")}>
            {["all", ...CATEGORIES].map((id) => (
              <Button
                key={id}
                size="sm"
                variant={category === id ? "secondary" : "ghost"}
                aria-pressed={category === id}
                onClick={() => setCategory(id)}
              >
                {m(`category.${id}`)}
              </Button>
            ))}
          </div>
          <div className={styles.metricCatalog}>
            {catalog.map((d) => (
              <button
                key={d.id}
                aria-pressed={d.id === metricId}
                onClick={(event) => {
                  chooseMetric(d.id);
                  const picker = event.currentTarget.closest("details");
                  if (picker) {
                    picker.open = false;
                    picker.querySelector("summary")?.focus();
                  }
                }}
              >
                <span className="font-medium">{d.name}</span>
                <span className="text-body-xs text-muted">
                  {m(`category.${d.category}`)} · {sourceLabel(d)}
                </span>
              </button>
            ))}
            {!catalog.length && <p className="p-3 text-muted">{m("noMetrics")}</p>}
          </div>
        </div>
      </details>
      <div className="mb-4 flex flex-wrap gap-2" aria-label={m("popular")}>
        {POPULAR.map((id) => data.definitions.find((d) => d.id === id))
          .filter((d): d is MapMetricDefinition => Boolean(d))
          .map((d) => (
            <Button
              key={d.id}
              size="sm"
              variant={d.id === metricId ? "secondary" : "ghost"}
              aria-pressed={d.id === metricId}
              onClick={() => chooseMetric(d.id)}
            >
              {d.name}
            </Button>
          ))}
      </div>
      <div className={styles.toolbar}>
        <div className={styles.segment}>
          <Button
            size="sm"
            variant={!table ? "secondary" : "ghost"}
            aria-pressed={!table}
            onClick={() => setTable(false)}
          >
            {t("atlas")}
          </Button>
          <Button
            size="sm"
            variant={table ? "secondary" : "ghost"}
            aria-pressed={table}
            onClick={() => setTable(true)}
          >
            {t("table")}
          </Button>
        </div>
        <Input
          className="!w-full sm:!w-52"
          type="search"
          aria-label={t("search")}
          placeholder={t("searchPlaceholder")}
          value={stateSearch}
          onChange={(e) => setStateSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-body-sm">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
          {t("labels")}
        </label>
        <label className="flex items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={valueLabels}
            onChange={(e) => setValueLabels(e.target.checked)}
          />
          {m("valuesOnMap")}
        </label>
      </div>
      <div className={styles.workspace}>
        <Card padding="none">
          <div className="border-b border-card-border p-4">
            <h2 className="text-heading-sm font-semibold">{definition.name}</h2>
            <p className="mt-1 text-body-sm text-muted">{definition.description}</p>
            <p className="mt-2 text-body-xs text-muted">
              {definition.source === "score" ? m("scoreNote") : m("measuredNote")}
            </p>
          </div>
          {table ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th
                      aria-sort={
                        sort === "name" ? (descending ? "descending" : "ascending") : "none"
                      }
                    >
                      <button onClick={() => sortBy("name")}>{t("state")} ↕</button>
                    </th>
                    <th
                      aria-sort={
                        sort === "value" ? (descending ? "descending" : "ascending") : "none"
                      }
                    >
                      <button onClick={() => sortBy("value")}>{definition.name} ↕</button>
                    </th>
                    <th>{m("rankLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.id} aria-selected={selected === r.id}>
                      <td>
                        <button onClick={() => setSelected(r.id)}>{r.name}</button>
                      </td>
                      <td>{format(r.value)}</td>
                      <td>{r.value == null ? t("noData") : rank(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleRows.length && <p className="p-4">{t("noResults")}</p>}
            </div>
          ) : (
            <>
              <div className={styles.mapStage}>
                <RegionalGeoMap
                  sourceUrl={USA_GEO_URL}
                  regionCodes={US_REGION_CODES.filter((id) => roster.some((r) => r.id === id))}
                  regionData={cells}
                  labelOverrides={
                    valueLabels ? { ...US_LABEL_OVERRIDES, ...valueOverrides } : US_LABEL_OVERRIDES
                  }
                  projection="geoAlbersUsa"
                  projectionConfig={{ scale: 1000 }}
                  width={960}
                  height={600}
                  zoomable
                  zoom={zoom}
                  onZoomChange={setZoom}
                  resetKey={resetKey}
                  showLabels={labels}
                  highlightedRegions={
                    selected ? [selected] : stateSearch ? visibleRows.map((r) => r.id) : []
                  }
                  highlightColor="var(--primary)"
                  onRegionClick={setSelected}
                  renderTooltip={(id) => {
                    const row = rows.find((r) => r.id === id);
                    const governor = mapData?.officeholders?.[id]?.find(
                      (h) => h.office === "governor"
                    );
                    return (
                      <div className={styles.tooltip}>
                        <p className="font-semibold">{row?.name ?? id}</p>
                        <p className="mt-2 text-body-sm text-muted">{definition.name}</p>
                        <p className="font-mono text-heading-sm">{format(row?.value)}</p>
                        {row?.value != null && (
                          <p className="mt-2 text-body-xs text-muted">
                            {m("rank", { rank: rank(row.value), count: measured.length })}
                          </p>
                        )}
                        {governor && <OfficeholderCard holder={governor} />}
                      </div>
                    );
                  }}
                />
              </div>
              <div className={styles.mapFooter}>
                <span>{t("mapHint")}</span>
                <div className={styles.zoomControls}>
                  <Button
                    size="sm"
                    aria-label={t("zoomOut")}
                    onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
                  >
                    −
                  </Button>
                  <span>{zoom.toFixed(1)}×</span>
                  <Button
                    size="sm"
                    aria-label={t("zoomIn")}
                    onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
                  >
                    +
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setZoom(1);
                      setResetKey((k) => k + 1);
                    }}
                  >
                    {t("reset")}
                  </Button>
                </div>
              </div>
              {stateSearch && (
                <div className="flex flex-wrap gap-2 p-3">
                  {visibleRows.map((r) => (
                    <Button key={r.id} size="sm" onClick={() => setSelected(r.id)}>
                      {r.name}
                    </Button>
                  ))}
                  {!visibleRows.length && <p>{t("noResults")}</p>}
                </div>
              )}
            </>
          )}
          {extent && (
            <div className="border-t border-card-border p-4">
              <div
                className="h-2 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${metricColor(extent.min, extent.min, extent.max)}, ${metricColor(extent.max, extent.min, extent.max)})`,
                }}
              />
              <div className="mt-2 flex justify-between gap-2 text-body-xs font-mono">
                <span>{format(extent.min, true)}</span>
                <span className="text-muted">{m("magnitude")}</span>
                <span>{format(extent.max, true)}</span>
              </div>
              <p className="mt-2 text-body-xs text-muted">
                {m("coverage", { count: measured.length, total: roster.length })} ·{" "}
                {m("missingLegend")}
              </p>
            </div>
          )}
        </Card>
        <aside className={styles.sidebar} aria-label={t("inspect")}>
          <Card>
            <h2 className="font-semibold">{selectedRow?.name ?? m("selectState")}</h2>
            {selectedRow ? (
              <>
                <p className="mt-2 text-body-sm text-muted">{definition.name}</p>
                <p className="mt-1 break-words font-mono text-heading-sm">
                  {format(selectedRow.value)}
                </p>
                {selectedRow.value != null && (
                  <p className="mt-2 text-body-xs text-muted">
                    {m("rank", { rank: rank(selectedRow.value), count: measured.length })}
                  </p>
                )}
                {extent && (
                  <p className="mt-3 text-body-sm">
                    {m("median")}: <span className="font-mono">{format(extent.median, true)}</span>
                  </p>
                )}
                <label className="mt-4 block text-body-sm">
                  {m("compare")}
                  <select
                    className={`${styles.layerSelect} mt-2 w-full !min-w-0`}
                    value={compare}
                    onChange={(e) => setCompare(e.target.value)}
                  >
                    <option value="">{m("chooseState")}</option>
                    {rows
                      .filter((r) => r.id !== selected)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                {comparedRow && comparedRow.id !== selected && (
                  <div className="mt-3 space-y-3">
                    {[selectedRow, comparedRow].map((r) => (
                      <div key={r.id}>
                        <div className="flex justify-between gap-2 text-body-xs">
                          <span>{r.name}</span>
                          <span className="font-mono">{format(r.value, true)}</span>
                        </div>
                        <div className={`${styles.track} mt-1`}>
                          <div
                            className={styles.bar}
                            style={{
                              background: color(r.value),
                              width: `${r.value == null || !extent ? 0 : Math.max(2, metricRatio(r.value, Math.min(0, extent.min), extent.max) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Button className="mt-4 w-full" size="sm" onClick={() => onOpen(selectedRow.id)}>
                  {t("openState")}
                </Button>
              </>
            ) : (
              <p className="mt-2 text-body-sm text-muted">{m("inspectHint")}</p>
            )}
          </Card>
          {extent && (
            <Card>
              <h2 className="font-semibold">{m("distribution")}</h2>
              <div className="mt-4 flex h-24 items-end gap-2" aria-label={m("distribution")}>
                {bins.map((count, i) => (
                  <div key={i} className="flex h-full flex-1 flex-col justify-end text-center">
                    <span className="text-body-xs text-muted">{count}</span>
                    <div
                      className="mt-1 rounded-t"
                      style={{
                        height: `${(count / maxBin) * 75}%`,
                        minHeight: count ? 3 : 0,
                        background: metricColor(i, 0, 4),
                      }}
                      title={m("bin", {
                        count,
                        low: format(extent.min + ((extent.max - extent.min) * i) / 5, true),
                        high: format(extent.min + ((extent.max - extent.min) * (i + 1)) / 5, true),
                      })}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-body-xs text-muted">
                <span>{format(extent.min, true)}</span>
                <span>{format(extent.max, true)}</span>
              </div>
            </Card>
          )}
          <Card>
            <h2 className="font-semibold">{m("highest")}</h2>
            <div className="mt-3 space-y-3">
              {[...measured]
                .sort((a, b) => b.value - a.value)
                .slice(0, 8)
                .map((r) => (
                  <button
                    className="block w-full text-left"
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                  >
                    <span className="flex justify-between gap-2 text-body-xs">
                      <span>{r.name}</span>
                      <span className="font-mono">{format(r.value, true)}</span>
                    </span>
                    <span className={`${styles.track} mt-1 block`}>
                      <span
                        className={`${styles.bar} block`}
                        style={{
                          background: color(r.value),
                          width: `${extent ? Math.max(2, metricRatio(r.value, Math.min(0, extent.min), extent.max) * 100) : 0}%`,
                        }}
                      />
                    </span>
                  </button>
                ))}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
