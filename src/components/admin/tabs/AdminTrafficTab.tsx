"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Resolution = "hour" | "day";

interface DailyRow {
  bucket: string;
  pageviews: number;
  visits: number;
  authenticatedPageviews: number;
}

interface TopPathRow {
  path: string;
  views: number;
  visits: number;
}

interface CountryRow {
  country: string;
  views: number;
  visits: number;
}

interface DeviceRow {
  deviceType: string;
  views: number;
  visits: number;
}

interface WeekdayRow {
  dow: number; // Mongo $dayOfWeek: 1 (Sun) .. 7 (Sat)
  views: number;
}

interface SlotRow {
  slot: number; // 0..3 in EST
  views: number;
}

interface SlowestRow {
  path: string;
  avgMs: number;
  samples: number;
}

interface SummaryPayload {
  resolution: Resolution;
  bucketCount: number;
  rangeLabel: string;
  rangeStart: string;
  days: number;
  hours: number;
  daily: DailyRow[];
  topPaths: TopPathRow[];
  totals: {
    pageviews: number;
    visits: number;
    authenticatedPageviews: number;
  };
  byCountry: CountryRow[];
  byDevice: DeviceRow[];
  byWeekday: WeekdayRow[];
  bySlot: SlotRow[];
  slowestPaths: SlowestRow[];
  integrated: boolean;
}

interface ChartRow {
  bucketKey: string;
  label: string;
  pageviews: number;
  visits: number;
  authenticatedPageviews: number;
}

type RangeOption =
  { kind: "hours"; value: number; label: string } | { kind: "days"; value: number; label: string };

const RANGE_OPTIONS: RangeOption[] = [
  { kind: "hours", value: 24, label: "24 hours" },
  { kind: "hours", value: 48, label: "48 hours" },
  { kind: "days", value: 7, label: "7 days" },
  { kind: "days", value: 14, label: "14 days" },
  { kind: "days", value: 30, label: "30 days" },
  { kind: "days", value: 60, label: "60 days" },
  { kind: "days", value: 90, label: "90 days" },
];

type Metric = "pageviews" | "visits";

function formatBucketLabel(bucket: string, resolution: Resolution): string {
  if (resolution === "hour") {
    // bucket: "YYYY-MM-DDTHH:00"
    return bucket.slice(11, 16); // HH:00
  }
  return bucket.slice(5); // MM-DD
}

/** Full bucket label for chart tooltips (UTC). */
function formatBucketTooltip(bucket: string, resolution: Resolution): string {
  if (resolution === "hour") {
    const d = bucket.slice(0, 10);
    const h = bucket.slice(11, 16);
    return `${d} ${h} UTC`;
  }
  return `${bucket} UTC`;
}

function buildChartRows(data: SummaryPayload): ChartRow[] {
  const map = new Map(data.daily.map((d) => [d.bucket, d]));
  const rows: ChartRow[] = [];
  const start = new Date(data.rangeStart);
  for (let i = 0; i < data.bucketCount; i++) {
    const d = new Date(start);
    if (data.resolution === "hour") d.setUTCHours(start.getUTCHours() + i);
    else d.setUTCDate(start.getUTCDate() + i);
    const key =
      data.resolution === "hour"
        ? `${d.toISOString().slice(0, 13)}:00`
        : d.toISOString().slice(0, 10);
    const hit = map.get(key);
    rows.push({
      bucketKey: key,
      label: formatBucketLabel(key, data.resolution),
      pageviews: hit?.pageviews ?? 0,
      visits: hit?.visits ?? 0,
      authenticatedPageviews: hit?.authenticatedPageviews ?? 0,
    });
  }
  return rows;
}

/** Show one X-axis tick every N buckets so dense ranges stay readable. */
function xAxisInterval(count: number, resolution: Resolution): number {
  if (resolution === "hour") {
    if (count <= 12) return 0;
    if (count <= 24) return 2;
    return 5;
  }
  if (count <= 14) return 0;
  if (count <= 30) return 2;
  if (count <= 60) return 6;
  return 13;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOT_LABELS = ["12am – 6am", "6am – 12pm", "12pm – 6pm", "6pm – 12am"];

// Best-effort ISO-3166-1 alpha-2 → flag emoji. "ZZ" stays as ⁠— (unknown).
function countryFlag(code: string): string {
  if (!code || code === "ZZ" || code.length !== 2) return "🌐";
  const base = 0x1f1e6;
  const A = "A".charCodeAt(0);
  return (
    String.fromCodePoint(base + code.toUpperCase().charCodeAt(0) - A) +
    String.fromCodePoint(base + code.toUpperCase().charCodeAt(1) - A)
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-block h-3.5 w-0.5 flex-shrink-0 rounded-full bg-primary" />
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{children}</h2>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-4 shadow-sm ${
        highlight ? "border-primary/40" : "border-card-border"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function TrafficSeriesTooltip({
  active,
  payload,
  resolution,
}: {
  active?: boolean;
  /** Recharts supplies a readonly payload; keep readonly to satisfy TooltipPayload typing. */
  payload?: readonly { payload?: ChartRow }[];
  resolution: Resolution;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-md border border-card-border bg-card px-3 py-2 text-body-sm shadow-md">
      <p className="mb-2 font-medium text-foreground">
        {formatBucketTooltip(row.bucketKey, resolution)}
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
        <dt className="text-muted">Page views</dt>
        <dd className="text-right font-medium text-foreground">
          {row.pageviews.toLocaleString("en-US")}
        </dd>
        <dt className="text-muted">Unique visitors</dt>
        <dd className="text-right font-medium text-foreground">
          {row.visits.toLocaleString("en-US")}
        </dd>
      </dl>
    </div>
  );
}

export function AdminTrafficTab() {
  const [rangeKey, setRangeKey] = useState<string>("days-14");
  /** Bar charts and path/country lists: which metric the bars encode. */
  const [breakdownMetric, setBreakdownMetric] = useState<Metric>("pageviews");
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [integrating, setIntegrating] = useState(false);
  const [integrateError, setIntegrateError] = useState<string | null>(null);

  const activeRange = useMemo(() => {
    const [kind, value] = rangeKey.split("-");
    const parsed = RANGE_OPTIONS.find((r) => r.kind === kind && String(r.value) === value);
    return parsed ?? RANGE_OPTIONS[3];
  }, [rangeKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        activeRange.kind === "hours" ? `hours=${activeRange.value}` : `days=${activeRange.value}`;
      const res = await fetch(`/api/admin/traffic/summary?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? `HTTP ${res.status}`);
        setData(null);
        return;
      }
      setData((await res.json()) as SummaryPayload);
    } catch {
      setError("Failed to load traffic data.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeRange]);

  const integrate = useCallback(async () => {
    setIntegrating(true);
    setIntegrateError(null);
    try {
      const res = await fetch("/api/admin/traffic/integrate", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setIntegrateError((j as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } catch {
      setIntegrateError("Integration request failed.");
    } finally {
      setIntegrating(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartRows = useMemo(() => (data ? buildChartRows(data) : []), [data]);

  const authPct = useMemo(() => {
    if (!data?.totals.pageviews) return 0;
    return Math.round((data.totals.authenticatedPageviews / data.totals.pageviews) * 1000) / 10;
  }, [data]);

  const busiestWeekday = useMemo(() => {
    if (!data || data.byWeekday.length === 0) return null;
    const top = [...data.byWeekday].sort((a, b) => b.views - a.views)[0];
    return { label: WEEKDAY_LABELS[(top.dow - 1) % 7], views: top.views };
  }, [data]);

  const busiestSlot = useMemo(() => {
    if (!data || data.bySlot.length === 0) return null;
    const top = [...data.bySlot].sort((a, b) => b.views - a.views)[0];
    return { label: SLOT_LABELS[top.slot] ?? "—", views: top.views };
  }, [data]);

  const topCountry = useMemo(() => {
    if (!data || data.byCountry.length === 0) return null;
    const top = data.byCountry[0];
    return top;
  }, [data]);

  const slowestPages = data?.slowestPaths ?? [];
  const breakdownKey = breakdownMetric === "pageviews" ? "pageviews" : "visits";

  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionLabel>Site traffic</SectionLabel>
        <p className="mb-4 max-w-3xl text-sm text-muted">
          First-party page views from the in-app tracker (idle-time sendBeacon). Unique visitors are
          approximated by distinct anonymous browser cookies (
          <code className="rounded bg-card-elevated px-1 font-mono text-xs">__ahd_track</code>
          ), not accounts. Load-time, device class, and country are recorded at ingestion.
        </p>

        {data && !data.integrated && (
          <div className="mb-6 flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-warning">One-time setup required</p>
              <p className="mt-0.5 text-xs text-muted">
                TTL and query indexes are missing. Click Integrate to create them — this only needs
                to run once per environment.
              </p>
              {integrateError && <p className="mt-1 text-xs text-destructive">{integrateError}</p>}
            </div>
            <button
              type="button"
              onClick={() => void integrate()}
              disabled={integrating}
              className="shrink-0 rounded-md bg-warning px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-50"
            >
              {integrating ? "Integrating…" : "Integrate"}
            </button>
          </div>
        )}

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-body-sm text-foreground">
              <span className="text-muted">Range</span>
              <select
                className="rounded-md border border-card-border bg-background px-2 py-1.5 text-body-sm text-foreground"
                value={rangeKey}
                onChange={(e) => setRangeKey(e.target.value)}
              >
                {RANGE_OPTIONS.map((o) => (
                  <option key={`${o.kind}-${o.value}`} value={`${o.kind}-${o.value}`}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="hidden h-6 w-px bg-card-border sm:block" aria-hidden />

            <div className="flex flex-col gap-1">
              <span className="text-body-xs font-medium uppercase tracking-wide text-muted">
                Breakdown bars
              </span>
              <div className="inline-flex overflow-hidden rounded-md border border-card-border">
                <button
                  type="button"
                  onClick={() => setBreakdownMetric("pageviews")}
                  className={`px-3 py-1.5 text-body-xs font-semibold transition-colors ${
                    breakdownMetric === "pageviews"
                      ? "bg-primary text-background"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  Page views
                </button>
                <button
                  type="button"
                  onClick={() => setBreakdownMetric("visits")}
                  className={`px-3 py-1.5 text-body-xs font-semibold transition-colors ${
                    breakdownMetric === "visits"
                      ? "bg-primary text-background"
                      : "bg-card text-muted hover:text-foreground"
                  }`}
                >
                  Unique visitors
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="w-full rounded-md border border-card-border bg-card px-3 py-1.5 text-body-sm font-medium text-foreground hover:bg-card-elevated sm:w-auto"
          >
            Refresh
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading…
          </div>
        )}
        {error && !loading && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {data && !loading && (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Page views" value={data.totals.pageviews.toLocaleString("en-US")} />
              <StatCard
                label="Unique visitors"
                value={data.totals.visits.toLocaleString("en-US")}
              />
              <StatCard
                label="Logged-in views"
                value={`${authPct}%`}
                sub={`${data.totals.authenticatedPageviews.toLocaleString("en-US")} hits with a valid session`}
              />
              <StatCard
                label="Top country"
                value={
                  topCountry ? `${countryFlag(topCountry.country)} ${topCountry.country}` : "—"
                }
                sub={
                  topCountry
                    ? `${topCountry.views.toLocaleString("en-US")} views`
                    : "No geo data yet"
                }
                highlight
              />
            </div>

            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <StatCard
                label="Busiest weekday"
                value={busiestWeekday?.label ?? "—"}
                sub={
                  busiestWeekday
                    ? `${busiestWeekday.views.toLocaleString("en-US")} views over ${data.rangeLabel}`
                    : "Not enough data"
                }
              />
              <StatCard
                label="Busiest 6h slot (EST)"
                value={busiestSlot?.label ?? "—"}
                sub={
                  busiestSlot
                    ? `${busiestSlot.views.toLocaleString("en-US")} views in window`
                    : "Not enough data"
                }
              />
              <StatCard
                label="Resolution"
                value={data.resolution === "hour" ? "Hourly" : "Daily"}
                sub={`${data.bucketCount} buckets · ${data.rangeLabel}`}
              />
            </div>

            <div className="mb-8 rounded-xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-body font-semibold text-foreground">Traffic over time</h3>
                  <p className="text-body-xs text-muted">
                    Page views and unique visitors per bucket (
                    {data.resolution === "hour" ? "UTC hourly" : "UTC daily"})
                  </p>
                </div>
                <span className="shrink-0 rounded-md border border-card-border bg-card-muted px-2 py-0.5 text-body-xs tabular-nums text-muted">
                  {data.rangeLabel}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={chartRows} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted)"
                    interval={xAxisInterval(data.bucketCount, data.resolution)}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="var(--color-muted)"
                    width={48}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={(props) => (
                      <TrafficSeriesTooltip
                        active={props.active}
                        payload={
                          props.payload as unknown as readonly { payload?: ChartRow }[] | undefined
                        }
                        resolution={data.resolution}
                      />
                    )}
                    cursor={{ stroke: "var(--color-muted)", strokeOpacity: 0.35 }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: 16, fontSize: 12 }}
                    formatter={(value) => (
                      <span className="text-body-xs text-foreground">{value}</span>
                    )}
                  />
                  <Line
                    type="linear"
                    name="Page views"
                    dataKey="pageviews"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                  />
                  <Line
                    type="linear"
                    name="Unique visitors"
                    dataKey="visits"
                    stroke="var(--color-secondary)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mb-8 grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
                <h3 className="mb-1 text-body font-semibold text-foreground">Top countries</h3>
                <p className="mb-3 text-body-xs text-muted">
                  Bars: {breakdownMetric === "pageviews" ? "page views" : "unique visitors"}
                </p>
                {data.byCountry.length === 0 ? (
                  <p className="text-sm text-muted">
                    No geo data in this range. Country is read from edge headers; self-hosted
                    environments without a geo CDN will see only ZZ.
                  </p>
                ) : (
                  (() => {
                    const countryMax = Math.max(
                      ...data.byCountry.map((row) =>
                        breakdownMetric === "pageviews" ? row.views : row.visits
                      ),
                      1
                    );
                    return (
                      <ul className="divide-y divide-card-border">
                        {data.byCountry.map((c) => {
                          const shown = breakdownMetric === "pageviews" ? c.views : c.visits;
                          const pct = Math.round((shown / countryMax) * 100);
                          return (
                            <li key={c.country} className="flex items-center gap-3 py-2">
                              <span className="shrink-0 text-base" aria-hidden>
                                {countryFlag(c.country)}
                              </span>
                              <span className="w-10 shrink-0 font-mono text-xs text-muted">
                                {c.country === "ZZ" ? "—" : c.country}
                              </span>
                              <div className="flex-1">
                                <div className="h-1.5 rounded-full bg-card-border">
                                  <div
                                    className="h-1.5 rounded-full bg-primary"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-foreground">
                                {shown.toLocaleString("en-US")}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()
                )}
              </div>

              <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
                <h3 className="mb-1 text-body font-semibold text-foreground">Device class</h3>
                <p className="mb-3 text-body-xs text-muted">
                  Bars: {breakdownMetric === "pageviews" ? "page views" : "unique visitors"}
                </p>
                {data.byDevice.length === 0 ? (
                  <p className="text-sm text-muted">No device data yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={data.byDevice}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--color-muted)" />
                      <YAxis
                        type="category"
                        dataKey="deviceType"
                        width={90}
                        tick={{ fontSize: 11 }}
                        stroke="var(--color-muted)"
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey={breakdownKey}
                        fill="var(--color-accent)"
                        radius={[0, 4, 4, 0]}
                        name={breakdownMetric === "pageviews" ? "Page views" : "Unique visitors"}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="mb-8 grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
                <h3 className="mb-1 text-body font-semibold text-foreground">Top paths</h3>
                <p className="mb-3 text-body-xs text-muted">
                  Bars: {breakdownMetric === "pageviews" ? "page views" : "unique visitors"}
                </p>
                {data.topPaths.length === 0 ? (
                  <p className="text-sm text-muted">No path data in this range.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={[...data.topPaths].reverse()}
                      layout="vertical"
                      margin={{ left: 8, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="var(--color-muted)" />
                      <YAxis
                        type="category"
                        dataKey="path"
                        width={180}
                        tick={{ fontSize: 10 }}
                        stroke="var(--color-muted)"
                        tickFormatter={(v: string) => (v.length > 28 ? `${v.slice(0, 26)}…` : v)}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey={breakdownKey}
                        fill="var(--color-primary)"
                        radius={[0, 4, 4, 0]}
                        name={breakdownMetric === "pageviews" ? "Page views" : "Unique visitors"}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm sm:p-5">
                <h3 className="mb-1 text-body font-semibold text-foreground">
                  Slowest paths (avg load time)
                </h3>
                <p className="mb-3 text-body-xs text-muted">
                  Client-reported navigation timing; sample size per path
                </p>
                {slowestPages.length === 0 ? (
                  <p className="text-sm text-muted">
                    No load-time samples yet. Performance data is recorded once visitors start
                    reporting navigation timings — usually within a few minutes of traffic.
                  </p>
                ) : (
                  <ul className="divide-y divide-card-border">
                    {slowestPages.map((p) => (
                      <li key={p.path} className="flex items-center justify-between gap-3 py-2">
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
                          title={p.path}
                        >
                          {p.path}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-body-xs font-semibold tabular-nums ${
                            p.avgMs >= 3000
                              ? "bg-error/15 text-error"
                              : p.avgMs >= 1500
                                ? "bg-warning/15 text-warning"
                                : "bg-success/15 text-success"
                          }`}
                        >
                          {p.avgMs.toLocaleString("en-US")} ms
                        </span>
                        <span className="w-12 shrink-0 text-right text-[10px] text-muted">
                          n={p.samples}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
