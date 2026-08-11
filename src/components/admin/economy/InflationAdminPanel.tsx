"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

interface InflationBreakdown {
  base: number;
  unemployment: number;
  gdp: number;
  monetary: number;
  fiscal: number;
  tariff: number;
  wage: number;
  commodity: number;
  forex: number;
  savings: number;
  policy: number;
  inertia: number;
}

interface InflationDiagnosticInputs {
  unemployment: number;
  gdpGrowth: number;
  primeRate: number;
  effectiveRate: number;
  primeRateHistoryLength: number;
  surplusToGdp: number;
  tariffRate: number;
  wageGrowth: number;
  commodityPressure: number;
  forexPressure: number;
  savingsPressure: number;
  policyStancePressure: number;
  previousInflation: number;
  fxRate: number | null;
  fxBaseRate: number | null;
}

interface TurnSnapshot {
  turn: number;
  rate: number;
}

interface InflationDiagnosticRow {
  countryId: string;
  countryName: string;
  storedRate: number | null;
  computedRate: number;
  storedHitsFloor: boolean;
  storedHitsCeiling: boolean;
  computedHitsFloor: boolean;
  computedHitsCeiling: boolean;
  inputs: InflationDiagnosticInputs;
  breakdown: InflationBreakdown;
  recentInflationHistory: TurnSnapshot[];
}

interface DiagnosticsPayload {
  currentTurn: number;
  minInflation: number;
  maxInflation: number;
  rows: InflationDiagnosticRow[];
}

const DRIVER_KEYS: { key: keyof InflationBreakdown; label: string }[] = [
  { key: "base", label: "Base" },
  { key: "unemployment", label: "Unemploy." },
  { key: "gdp", label: "GDP" },
  { key: "monetary", label: "Monetary" },
  { key: "fiscal", label: "Fiscal" },
  { key: "tariff", label: "Tariff" },
  { key: "wage", label: "Wage" },
  { key: "commodity", label: "Commodity" },
  { key: "forex", label: "FX" },
  { key: "savings", label: "Savings" },
  { key: "policy", label: "Stance" },
  { key: "inertia", label: "Inertia" },
];

function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtSigned(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function findDominantNegativeDriver(
  breakdown: InflationBreakdown
): { key: keyof InflationBreakdown; label: string; value: number } | null {
  let worst: { key: keyof InflationBreakdown; label: string; value: number } | null = null;
  for (const { key, label } of DRIVER_KEYS) {
    if (key === "base") continue;
    const value = breakdown[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value >= 0) continue;
    if (!worst || value < worst.value) {
      worst = { key, label, value };
    }
  }
  return worst;
}

/** Inline sparkline of recent inflation history. Highlights when the rate touches the floor. */
function HistorySparkline({
  history,
  minInflation,
  maxInflation,
}: {
  history: TurnSnapshot[];
  minInflation: number;
  maxInflation: number;
}) {
  if (history.length < 2) {
    return (
      <svg width={120} height={32} className="block">
        <line x1={0} y1={16} x2={120} y2={16} stroke="currentColor" strokeOpacity={0.15} />
      </svg>
    );
  }
  const W = 120;
  const H = 32;
  const rates = history.map((p) => p.rate);
  // Pin axis to floor / ceiling so floor visits are visually grounded.
  const min = Math.min(...rates, minInflation);
  const max = Math.max(...rates, Math.min(maxInflation, Math.max(...rates) + 0.5));
  const range = max - min || 1;
  const toX = (i: number) => (i / (rates.length - 1)) * (W - 4) + 2;
  const toY = (v: number) => H - 2 - ((v - min) / range) * (H - 4);
  const points = rates.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const floorY = toY(minInflation);
  const lastTouchedFloor = rates[rates.length - 1] <= minInflation + 1e-6;
  return (
    <svg width={W} height={H} className="block">
      <line
        x1={0}
        y1={floorY}
        x2={W}
        y2={floorY}
        stroke="rgb(239 68 68 / 0.45)"
        strokeDasharray="3 2"
        strokeWidth={1}
      />
      <polyline
        points={points}
        fill="none"
        stroke={lastTouchedFloor ? "rgb(239 68 68)" : "rgb(96 165 250)"}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Stacked horizontal bar of signed driver contributions. Negative left, positive right. */
function BreakdownBars({ breakdown }: { breakdown: InflationBreakdown }) {
  const entries = DRIVER_KEYS.map(({ key, label }) => ({
    label,
    value: breakdown[key] ?? 0,
  }));
  const totalAbs = entries.reduce((sum, e) => sum + Math.abs(e.value), 0) || 1;
  return (
    <div className="space-y-1 text-[11px] leading-tight">
      {entries
        .filter((e) => Math.abs(e.value) > 0.01)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .map((e) => {
          const widthPct = Math.min(100, (Math.abs(e.value) / totalAbs) * 100);
          const positive = e.value >= 0;
          return (
            <div
              key={e.label}
              className="flex items-center gap-2 font-mono"
              title={`${e.label}: ${fmtSigned(e.value)} pp`}
            >
              <span className="w-16 truncate text-muted">{e.label}</span>
              <div className="flex h-2 flex-1 items-stretch overflow-hidden rounded-sm bg-card-elevated">
                <div className="flex w-1/2 justify-end">
                  {!positive && (
                    <div
                      className="bg-red-500/70"
                      style={{ width: `${Math.min(100, widthPct * 2)}%` }}
                    />
                  )}
                </div>
                <div className="flex w-1/2 justify-start">
                  {positive && (
                    <div
                      className="bg-emerald-500/70"
                      style={{ width: `${Math.min(100, widthPct * 2)}%` }}
                    />
                  )}
                </div>
              </div>
              <span
                className={`w-12 text-right tabular-nums ${
                  positive
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {fmtSigned(e.value)}
              </span>
            </div>
          );
        })}
    </div>
  );
}

export function InflationAdminPanel() {
  const [data, setData] = useState<DiagnosticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/inflation", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as DiagnosticsPayload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleExpanded = (countryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(countryId)) next.delete(countryId);
      else next.add(countryId);
      return next;
    });
  };

  const summary = useMemo(() => {
    if (!data) return null;
    const flooredCountries = data.rows.filter((r) => r.storedHitsFloor || r.computedHitsFloor);
    const ceilingCountries = data.rows.filter((r) => r.storedHitsCeiling || r.computedHitsCeiling);
    return {
      flooredCountries,
      ceilingCountries,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Inflation Diagnostics</h2>
          <p className="text-xs text-muted">
            Per-country stored vs. recomputed inflation, with the signed contribution of every
            driver. Use to identify which channel is pushing a country to the floor.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchData}
          className="rounded-md border border-card-border bg-card-elevated px-3 py-1.5 text-xs font-medium hover:bg-card"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {data && (
        <div className="rounded-md border border-card-border bg-card-elevated px-3 py-2 text-xs">
          <span className="text-muted">Turn </span>
          <span className="font-mono font-semibold">{data.currentTurn}</span>
          <span className="ml-3 text-muted">Floor </span>
          <span className="font-mono">{fmtPct(data.minInflation)}</span>
          <span className="ml-3 text-muted">Ceiling </span>
          <span className="font-mono">{fmtPct(data.maxInflation)}</span>
          {summary && summary.flooredCountries.length > 0 && (
            <span className="ml-3 text-red-600 dark:text-red-400">
              {summary.flooredCountries.length} country at floor:{" "}
              {summary.flooredCountries.map((r) => r.countryId).join(", ")}
            </span>
          )}
          {summary && summary.ceilingCountries.length > 0 && (
            <span className="ml-3 text-amber-600 dark:text-amber-400">
              {summary.ceilingCountries.length} country at ceiling:{" "}
              {summary.ceilingCountries.map((r) => r.countryId).join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-card-border">
        <table className="min-w-full divide-y divide-card-border text-sm">
          <thead className="bg-card-elevated text-left text-xs font-medium uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Country</th>
              <th className="px-3 py-2 text-right">Stored</th>
              <th className="px-3 py-2 text-right">Recomputed</th>
              <th className="px-3 py-2 text-right">Δ</th>
              <th className="px-3 py-2">Recent</th>
              <th className="px-3 py-2">Dominant Drag</th>
              <th className="px-3 py-2 text-right">Prime</th>
              <th className="px-3 py-2 text-right">Eff. Rate</th>
              <th className="px-3 py-2 text-right">FX rate</th>
              <th className="px-3 py-2 text-right">Surplus/GDP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border bg-card">
            {data?.rows.map((row) => {
              const drag = findDominantNegativeDriver(row.breakdown);
              const isExpanded = expanded.has(row.countryId);
              const delta = row.storedRate != null ? row.computedRate - row.storedRate : null;
              return (
                <Fragment key={row.countryId}>
                  <tr
                    className={
                      row.storedHitsFloor || row.computedHitsFloor
                        ? "bg-red-500/5"
                        : row.storedHitsCeiling || row.computedHitsCeiling
                          ? "bg-amber-500/5"
                          : ""
                    }
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.countryName}</div>
                      <div className="text-xs text-muted">{row.countryId}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span
                        className={
                          row.storedHitsFloor
                            ? "font-semibold text-red-600 dark:text-red-400"
                            : row.storedHitsCeiling
                              ? "font-semibold text-amber-600 dark:text-amber-400"
                              : ""
                        }
                      >
                        {fmtPct(row.storedRate)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span
                        className={
                          row.computedHitsFloor
                            ? "font-semibold text-red-600 dark:text-red-400"
                            : row.computedHitsCeiling
                              ? "font-semibold text-amber-600 dark:text-amber-400"
                              : ""
                        }
                      >
                        {fmtPct(row.computedRate)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted">
                      {delta == null ? "—" : fmtSigned(delta)}
                    </td>
                    <td className="px-3 py-2">
                      <HistorySparkline
                        history={row.recentInflationHistory}
                        minInflation={data!.minInflation}
                        maxInflation={data!.maxInflation}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {drag ? (
                        <span>
                          <span className="text-muted">{drag.label}:</span>{" "}
                          <span className="font-mono text-red-600 dark:text-red-400">
                            {fmtSigned(drag.value)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtPct(row.inputs.primeRate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtPct(row.inputs.effectiveRate)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {row.inputs.fxRate != null && row.inputs.fxBaseRate != null
                        ? `${fmtNum(row.inputs.fxRate, 4)} / ${fmtNum(row.inputs.fxBaseRate, 4)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmtPct(row.inputs.surplusToGdp * 100)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.countryId)}
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        {isExpanded ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={11} className="bg-card-elevated px-4 py-3">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                              Driver Breakdown (pp)
                            </h3>
                            <BreakdownBars breakdown={row.breakdown} />
                          </div>
                          <div>
                            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                              Inputs
                            </h3>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
                              <dt className="text-muted">Unemployment</dt>
                              <dd className="text-right">{fmtPct(row.inputs.unemployment)}</dd>
                              <dt className="text-muted">GDP growth</dt>
                              <dd className="text-right">{fmtPct(row.inputs.gdpGrowth)}</dd>
                              <dt className="text-muted">Prime rate (spot)</dt>
                              <dd className="text-right">{fmtPct(row.inputs.primeRate)}</dd>
                              <dt className="text-muted">Effective rate</dt>
                              <dd className="text-right">{fmtPct(row.inputs.effectiveRate)}</dd>
                              <dt className="text-muted">Rate-history depth</dt>
                              <dd className="text-right">{row.inputs.primeRateHistoryLength}</dd>
                              <dt className="text-muted">Surplus / GDP</dt>
                              <dd className="text-right">
                                {fmtPct(row.inputs.surplusToGdp * 100)}
                              </dd>
                              <dt className="text-muted">Tariff rate</dt>
                              <dd className="text-right">{fmtPct(row.inputs.tariffRate)}</dd>
                              <dt className="text-muted">Wage growth</dt>
                              <dd className="text-right">{fmtPct(row.inputs.wageGrowth)}</dd>
                              <dt className="text-muted">Commodity pressure</dt>
                              <dd className="text-right">
                                {fmtSigned(row.inputs.commodityPressure * 100)}%
                              </dd>
                              <dt className="text-muted">FX pressure</dt>
                              <dd className="text-right">
                                {fmtSigned(row.inputs.forexPressure * 100)}%
                              </dd>
                              <dt className="text-muted">Savings pressure</dt>
                              <dd className="text-right">
                                {fmtSigned(row.inputs.savingsPressure * 100)}%
                              </dd>
                              <dt className="text-muted">Monetary stance</dt>
                              <dd className="text-right">
                                {fmtSigned(row.inputs.policyStancePressure)} pp
                              </dd>
                              <dt className="text-muted">Previous inflation</dt>
                              <dd className="text-right">{fmtPct(row.inputs.previousInflation)}</dd>
                            </dl>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && data && data.rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-sm text-muted">
                  No central banks found.
                </td>
              </tr>
            )}
            {loading && !data && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-sm text-muted">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
