"use client";

import React, { useState, useEffect, useCallback } from "react";

interface TurnSnapshot {
  turn: number;
  rate: number;
}

interface CurrencyRow {
  countryId: string;
  currencyCode: string;
  rate: number;
  baseRate: number;
  deviation: number;
  hardPeg: number | null;
  history: TurnSnapshot[];
}

const CURRENCY_COLORS: Record<string, string> = {
  INT: "#a0a0a0",
  USD: "#f472b6", // pink
  GBP: "#fb923c", // orange
  JPY: "#60a5fa", // blue
  CAD: "#4ade80", // green
  EUR: "#c084fc", // purple
};

/** Inline sparkline for the table rows. */
function DeviationSparkline({
  history,
  baseRate,
  turnWindow,
}: {
  history: TurnSnapshot[];
  baseRate: number;
  turnWindow: number;
}) {
  const sliced = turnWindow > 0 ? history.slice(-turnWindow) : history;
  if (sliced.length < 2) {
    return (
      <svg width={300} height={60} className="block">
        <line x1={0} y1={30} x2={300} y2={30} stroke="currentColor" strokeOpacity={0.2} />
      </svg>
    );
  }

  const deviations = sliced.map((s) => ((s.rate - baseRate) / baseRate) * 100);
  const min = Math.min(...deviations, -0.5);
  const max = Math.max(...deviations, 0.5);
  const range = max - min || 1;

  const toX = (i: number) => (i / (sliced.length - 1)) * 300;
  const toY = (v: number) => 60 - ((v - min) / range) * 56 - 2;

  const points = deviations.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  const zeroY = toY(0);

  return (
    <svg width={300} height={60} className="block text-primary">
      <line
        x1={0}
        y1={zeroY}
        x2={300}
        y2={zeroY}
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeDasharray="4 2"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Multi-currency overlay chart showing % deviation from base rate over time. */
function RateHistoryChart({
  currencies,
  turnWindow,
}: {
  currencies: CurrencyRow[];
  turnWindow: number;
}) {
  const [enabled, setEnabled] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    currencies.forEach((c) => {
      if (c.countryId !== "INT") initial.add(c.currencyCode);
    });
    return initial;
  });
  const [viewMode, setViewMode] = useState<"last" | "all">("last");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const toggle = (code: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const activeCurrencies = currencies.filter((c) => enabled.has(c.currencyCode));

  // Build deviation series for each active currency
  const series = activeCurrencies.map((c) => {
    const sliced = viewMode === "last" && turnWindow > 0 ? c.history.slice(-turnWindow) : c.history;
    return {
      code: c.currencyCode,
      color: CURRENCY_COLORS[c.currencyCode] ?? "#94a3b8",
      data: sliced.map((s) => ({
        turn: s.turn,
        deviation: ((s.rate - c.baseRate) / c.baseRate) * 100,
        rate: s.rate,
      })),
    };
  });

  // Compute shared axis bounds
  const allDeviations = series.flatMap((s) => s.data.map((d) => d.deviation));
  const allTurns = series.flatMap((s) => s.data.map((d) => d.turn));

  if (allDeviations.length < 2 || allTurns.length < 2) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-center text-sm text-muted">
        Not enough history data to display chart.
      </div>
    );
  }

  const minDev = Math.min(...allDeviations, -0.5);
  const maxDev = Math.max(...allDeviations, 0.5);
  const devRange = maxDev - minDev || 1;
  const minTurn = Math.min(...allTurns);
  const maxTurn = Math.max(...allTurns);
  const turnRange = maxTurn - minTurn || 1;

  const W = 900;
  const H = 240;
  const PAD = { top: 20, right: 20, bottom: 30, left: 55 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const toX = (turn: number) => PAD.left + ((turn - minTurn) / turnRange) * plotW;
  const toY = (dev: number) => PAD.top + plotH - ((dev - minDev) / devRange) * plotH;
  const zeroY = toY(0);

  // Y-axis tick values
  const yTicks: number[] = [];
  const yStep = devRange < 2 ? 0.5 : devRange < 10 ? 1 : devRange < 50 ? 5 : 10;
  const yStart = Math.ceil(minDev / yStep) * yStep;
  for (let v = yStart; v <= maxDev; v += yStep) {
    yTicks.push(Math.round(v * 100) / 100);
  }

  // X-axis tick values
  const xTicks: number[] = [];
  const desiredXTicks = 8;
  const xStep = Math.max(1, Math.round(turnRange / desiredXTicks));
  for (let t = minTurn; t <= maxTurn; t += xStep) {
    xTicks.push(t);
  }

  // Hover: find the closest turn index
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    const turn = minTurn + ((mouseX - PAD.left) / plotW) * turnRange;
    // Find closest data point index across all series
    if (series.length > 0 && series[0].data.length > 0) {
      let closest = 0;
      let closestDist = Infinity;
      series[0].data.forEach((d, i) => {
        const dist = Math.abs(d.turn - turn);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      });
      setHoverIndex(closest);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 border-b border-card-border">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider">Rate History</h3>
          <p className="text-xs text-muted">% deviation from base · compare multiple currencies</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-card-border text-xs overflow-hidden">
            <button
              onClick={() => setViewMode("last")}
              className={`px-2.5 py-1 transition-colors ${viewMode === "last" ? "bg-primary text-primary-foreground" : "hover:bg-background/60"}`}
            >
              Last
            </button>
            <button
              onClick={() => setViewMode("all")}
              className={`px-2.5 py-1 transition-colors ${viewMode === "all" ? "bg-primary text-primary-foreground" : "hover:bg-background/60"}`}
            >
              All
            </button>
          </div>
          <span className="text-xs text-muted mx-1">Turns</span>
          <div className="flex gap-1">
            {currencies.map((c) => {
              const color = CURRENCY_COLORS[c.currencyCode] ?? "#94a3b8";
              const isActive = enabled.has(c.currencyCode);
              return (
                <button
                  key={c.currencyCode}
                  onClick={() => toggle(c.currencyCode)}
                  className="text-xs font-semibold px-2.5 py-1 rounded-md border transition-all"
                  style={{
                    borderColor: isActive ? color : "var(--card-border)",
                    backgroundColor: isActive ? color + "22" : "transparent",
                    color: isActive ? color : "var(--muted)",
                    opacity: isActive ? 1 : 0.5,
                  }}
                >
                  {c.currencyCode}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ maxHeight: 280 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {/* Grid lines */}
          {yTicks.map((v) => (
            <g key={`y-${v}`}>
              <line
                x1={PAD.left}
                y1={toY(v)}
                x2={W - PAD.right}
                y2={toY(v)}
                stroke="currentColor"
                strokeOpacity={v === 0 ? 0.3 : 0.08}
                strokeDasharray={v === 0 ? undefined : "3 3"}
              />
              <text
                x={PAD.left - 8}
                y={toY(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted"
                fontSize={10}
              >
                {v.toFixed(v % 1 === 0 ? 0 : 1)}%
              </text>
            </g>
          ))}

          {/* X-axis ticks */}
          {xTicks.map((t) => (
            <text
              key={`x-${t}`}
              x={toX(t)}
              y={H - 6}
              textAnchor="middle"
              className="fill-muted"
              fontSize={10}
            >
              −{maxTurn - t}
            </text>
          ))}

          {/* Zero line */}
          <line
            x1={PAD.left}
            y1={zeroY}
            x2={W - PAD.right}
            y2={zeroY}
            stroke="currentColor"
            strokeOpacity={0.3}
          />

          {/* Data lines */}
          {series.map((s) => {
            if (s.data.length < 2) return null;
            const points = s.data.map((d) => `${toX(d.turn)},${toY(d.deviation)}`).join(" ");
            return (
              <polyline
                key={s.code}
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {/* Hover crosshair + dots */}
          {hoverIndex !== null && series.length > 0 && series[0].data[hoverIndex] && (
            <>
              <line
                x1={toX(series[0].data[hoverIndex].turn)}
                y1={PAD.top}
                x2={toX(series[0].data[hoverIndex].turn)}
                y2={H - PAD.bottom}
                stroke="currentColor"
                strokeOpacity={0.2}
                strokeDasharray="3 3"
              />
              {series.map((s) => {
                const pt = s.data[hoverIndex];
                if (!pt) return null;
                return (
                  <circle
                    key={s.code}
                    cx={toX(pt.turn)}
                    cy={toY(pt.deviation)}
                    r={3.5}
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                );
              })}
            </>
          )}
        </svg>

        {/* Hover tooltip */}
        {hoverIndex !== null && series.length > 0 && series[0].data[hoverIndex] && (
          <div className="flex items-center gap-4 mt-2 text-xs text-muted">
            <span>Turn {series[0].data[hoverIndex].turn}</span>
            {series.map((s) => {
              const pt = s.data[hoverIndex];
              if (!pt) return null;
              return (
                <span key={s.code} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.code}: {pt.rate.toFixed(4)} ({pt.deviation >= 0 ? "+" : ""}
                  {pt.deviation.toFixed(2)}%)
                </span>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-4 mt-3 text-xs">
          {series.map((s) => (
            <span key={s.code} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span style={{ color: s.color }}>{s.code}</span>
              <span className="text-muted">
                —{" "}
                {currencies.find((c) => c.currencyCode === s.code)?.countryId === "INT"
                  ? "Internal"
                  : s.code === "USD"
                    ? "US Dollar"
                    : s.code === "GBP"
                      ? "British Pound"
                      : s.code === "JPY"
                        ? "Japanese Yen"
                        : s.code === "CAD"
                          ? "Canadian Dollar"
                          : s.code === "EUR"
                            ? "Euro"
                            : s.code}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ForexAdminPanel() {
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turnWindow, setTurnWindow] = useState(48);

  // Per-row inline action state
  // Track open panels by countryId (the route identifier), not currencyCode
  const [nudgeOpen, setNudgeOpen] = useState<string | null>(null);
  const [nudgeValue, setNudgeValue] = useState("");
  const [pegOpen, setPegOpen] = useState<string | null>(null);
  const [pegValue, setPegValue] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [seedRunning, setSeedRunning] = useState(false);
  const [seedResult, setSeedResult] = useState<{
    seeded?: Record<string, number>;
    skipped?: string[];
    error?: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/forex");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setCurrencies(json.currencies);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleNudge = async (currencyId: string) => {
    const rate = parseFloat(nudgeValue);
    if (isNaN(rate) || rate <= 0) {
      setActionError("Rate must be a positive number");
      return;
    }
    setActionLoading(currencyId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/forex/${currencyId}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNudgeOpen(null);
      setNudgeValue("");
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePeg = async (currencyId: string) => {
    const rate = parseFloat(pegValue);
    if (isNaN(rate) || rate <= 0) {
      setActionError("Rate must be a positive number");
      return;
    }
    setActionLoading(currencyId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/forex/${currencyId}/peg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPegOpen(null);
      setPegValue("");
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnpeg = async (currencyId: string) => {
    if (!confirm(`Remove hard peg for ${currencyId}? Rate drift will resume next turn.`)) return;
    setActionLoading(currencyId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/forex/${currencyId}/peg`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchData();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Forex</h2>
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={seedRunning}
            onClick={async () => {
              if (
                !confirm(
                  "Seed FX reserves for active forex countries? Idempotent — countries with non-zero reserves are skipped."
                )
              )
                return;
              setSeedRunning(true);
              setSeedResult(null);
              try {
                const res = await fetch("/api/admin/forex/seed-reserves", { method: "POST" });
                const json = await res.json();
                if (!res.ok) {
                  setSeedResult({ error: json.error ?? `HTTP ${res.status}` });
                } else {
                  setSeedResult({ seeded: json.seeded, skipped: json.skipped });
                }
              } catch (e) {
                setSeedResult({ error: e instanceof Error ? e.message : "Failed" });
              } finally {
                setSeedRunning(false);
              }
            }}
            className="rounded border border-card-border bg-card-elevated px-3 py-1 text-sm hover:bg-card-elevated/80 disabled:opacity-50"
          >
            {seedRunning ? "Seeding…" : "Seed FX Reserves"}
          </button>
          <label className="text-muted">History turns:</label>
          <input
            type="number"
            min={2}
            max={240}
            value={turnWindow}
            onChange={(e) => setTurnWindow(Number(e.target.value))}
            className="w-20 rounded border border-card-border bg-background px-2 py-1 text-sm"
          />
        </div>
      </div>

      {seedResult && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-3 text-sm">
          {seedResult.error ? (
            <p className="text-error">Seed failed: {seedResult.error}</p>
          ) : (
            <>
              <p>
                Seeded:{" "}
                {seedResult.seeded && Object.keys(seedResult.seeded).length > 0
                  ? Object.entries(seedResult.seeded)
                      .map(([c, v]) => `${c}=${v.toLocaleString("en-US")}`)
                      .join(", ")
                  : "none"}
              </p>
              {seedResult.skipped && seedResult.skipped.length > 0 && (
                <p className="text-muted">
                  Skipped (already seeded): {seedResult.skipped.join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Overlay comparison chart */}
      {!loading && currencies.length > 0 && (
        <RateHistoryChart currencies={currencies} turnWindow={turnWindow} />
      )}

      {error && <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{error}</p>}
      {actionError && (
        <p className="text-sm text-error bg-error/10 rounded-lg px-4 py-3">{actionError}</p>
      )}

      {loading ? (
        <div className="text-muted text-sm py-8 text-center">Loading…</div>
      ) : (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr>
                  {["Currency", "Rate", "Base Rate", "Deviation", "Trend", "Actions"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {currencies.map((row) => (
                  <React.Fragment key={row.countryId}>
                    <tr className="hover:bg-background/40 transition-colors duration-150">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{row.currencyCode}</span>
                          {row.hardPeg != null && (
                            <span className="text-[10px] font-semibold uppercase bg-warning/20 text-warning px-1.5 py-0.5 rounded">
                              Pegged
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{row.rate.toFixed(4)}</td>
                      <td className="px-4 py-3 text-muted">{row.baseRate.toFixed(4)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            row.deviation > 0
                              ? "text-success"
                              : row.deviation < 0
                                ? "text-error"
                                : "text-muted"
                          }
                        >
                          {row.deviation > 0 ? "+" : ""}
                          {row.deviation.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <DeviationSparkline
                          history={row.history}
                          baseRate={row.baseRate}
                          turnWindow={turnWindow}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {row.countryId === "INT" ? (
                          <span className="text-xs text-muted">Internal unit — fixed</span>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setNudgeOpen(nudgeOpen === row.countryId ? null : row.countryId);
                                setPegOpen(null);
                                setActionError(null);
                              }}
                              disabled={actionLoading === row.countryId}
                              className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                            >
                              Nudge
                            </button>
                            {row.hardPeg != null ? (
                              <button
                                onClick={() => handleUnpeg(row.countryId)}
                                disabled={actionLoading === row.countryId}
                                className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10 transition-colors"
                              >
                                Unpeg
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setPegOpen(pegOpen === row.countryId ? null : row.countryId);
                                  setNudgeOpen(null);
                                  setActionError(null);
                                }}
                                disabled={actionLoading === row.countryId}
                                className="text-xs px-2 py-1 rounded border border-card-border hover:bg-background/60 transition-colors"
                              >
                                Peg
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Inline nudge panel */}
                    {nudgeOpen === row.countryId && (
                      <tr key={`${row.countryId}-nudge`}>
                        <td colSpan={6} className="px-4 py-3 bg-background/40">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted">Set rate to:</span>
                            <input
                              type="number"
                              step="0.0001"
                              min="0.0001"
                              value={nudgeValue}
                              onChange={(e) => setNudgeValue(e.target.value)}
                              placeholder={row.rate.toFixed(4)}
                              className="w-32 rounded border border-card-border bg-background px-2 py-1 text-sm"
                            />
                            <button
                              onClick={() => handleNudge(row.countryId)}
                              disabled={actionLoading === row.countryId}
                              className="text-xs px-3 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => {
                                setNudgeOpen(null);
                                setNudgeValue("");
                              }}
                              className="text-xs text-muted hover:text-foreground"
                            >
                              Cancel
                            </button>
                            <span className="text-xs text-muted">Drift resumes next turn.</span>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Inline peg panel */}
                    {pegOpen === row.countryId && (
                      <tr key={`${row.countryId}-peg`}>
                        <td colSpan={6} className="px-4 py-3 bg-background/40">
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted">Peg rate at:</span>
                            <input
                              type="number"
                              step="0.0001"
                              min="0.0001"
                              value={pegValue}
                              onChange={(e) => setPegValue(e.target.value)}
                              placeholder={row.rate.toFixed(4)}
                              className="w-32 rounded border border-card-border bg-background px-2 py-1 text-sm"
                            />
                            <button
                              onClick={() => handlePeg(row.countryId)}
                              disabled={actionLoading === row.countryId}
                              className="text-xs px-3 py-1 rounded bg-warning text-warning-foreground hover:opacity-90 transition-opacity"
                            >
                              Set Peg
                            </button>
                            <button
                              onClick={() => {
                                setPegOpen(null);
                                setPegValue("");
                              }}
                              className="text-xs text-muted hover:text-foreground"
                            >
                              Cancel
                            </button>
                            <span className="text-xs text-muted">
                              Rate will be held until peg is removed.
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
