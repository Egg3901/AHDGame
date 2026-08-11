"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type DiagnosticMode = "conformance" | "drift";
type Severity = "ok" | "warn" | "critical";

interface SeedDiagnosticCheck {
  id: string;
  scope: string;
  metric: string;
  expected: number | string | null;
  actual: number | string | null;
  driftPct?: number;
  tolerancePct?: number;
  severity: Severity;
  note?: string;
}

interface SeedDiagnosticReport {
  _id: string;
  ranAt: string;
  mode: DiagnosticMode;
  trigger: string;
  preset: string;
  turn: number;
  calendarTurn: number;
  summary: { ok: number; warn: number; critical: number };
  checks: SeedDiagnosticCheck[];
  note?: string;
}

function severityColor(severity: Severity): string {
  if (severity === "ok") return "text-green-400";
  if (severity === "warn") return "text-amber-400";
  return "text-red-400";
}

function formatPct(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatValue(value: number | string | null): string {
  if (value == null) return "-";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return String(value);
    if (Math.abs(value) >= 1e9 || (Math.abs(value) > 0 && Math.abs(value) < 1e-2)) {
      return value.toExponential(3);
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(value);
}

function groupKey(check: SeedDiagnosticCheck): string {
  const head = check.id.split(".")[0] ?? "other";
  return head;
}

export function SeedDiagnosticPanel() {
  const [mode, setMode] = useState<DiagnosticMode>("conformance");
  const [loading, setLoading] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [report, setReport] = useState<SeedDiagnosticReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    setLoadingLatest(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/seed-diagnostic?limit=1");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load latest report");
        return;
      }
      setReport((data.latest as SeedDiagnosticReport | null) ?? null);
    } catch {
      setError("Network error loading latest report");
    } finally {
      setLoadingLatest(false);
    }
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  async function handleRun() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/seed-diagnostic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Diagnostic failed");
        return;
      }
      setReport(data.report as SeedDiagnosticReport);
    } catch {
      setError("Network error running diagnostic");
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    if (!report) return [];
    const map = new Map<string, SeedDiagnosticCheck[]>();
    for (const c of report.checks) {
      const key = groupKey(c);
      const list = map.get(key) ?? [];
      list.push(c);
      map.set(key, list);
    }
    // Within each group: critical → warn → ok
    const rank: Record<Severity, number> = { critical: 0, warn: 1, ok: 2 };
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, checks]) => ({
        key,
        checks: [...checks].sort((a, b) => rank[a.severity] - rank[b.severity]),
      }));
  }, [report]);

  const showDriftCols = report?.mode === "drift";

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
      <h3 className="text-sm font-semibold text-white">Seed Diagnostic</h3>
      <p className="text-xs text-muted">
        Conformance checks that a fresh reset matches the era seed. Drift compares live macros to
        the post-reset baseline (growth-adjusted), with tolerances that widen over turns.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted" htmlFor="seed-diagnostic-mode">
          Mode
        </label>
        <select
          id="seed-diagnostic-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as DiagnosticMode)}
          disabled={loading}
          className="text-sm px-2 py-1 rounded border border-card-border bg-card-elevated text-white disabled:opacity-40"
        >
          <option value="conformance">Conformance</option>
          <option value="drift">Drift</option>
        </select>
        <button
          type="button"
          onClick={handleRun}
          disabled={loading}
          className="text-sm px-3 py-1.5 rounded border border-white/20 text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
        >
          {loading ? "Running…" : "Run seed diagnostic"}
        </button>
        <button
          type="button"
          onClick={() => void loadLatest()}
          disabled={loading || loadingLatest}
          className="text-sm px-3 py-1.5 rounded border border-white/10 text-muted hover:bg-white/5 disabled:opacity-40 transition-colors"
        >
          Refresh latest
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {loadingLatest && !report && <p className="text-xs text-muted">Loading latest report…</p>}

      {report && (
        <div className="text-xs space-y-3">
          <p>
            <span className="text-muted">
              {report.mode} · {report.preset} · turn {report.turn} (calendar {report.calendarTurn})
              · {new Date(report.ranAt).toLocaleString()}
            </span>
          </p>
          <p>
            <span className="text-green-400">{report.summary.ok} ok</span>
            {", "}
            <span className="text-amber-400">{report.summary.warn} warn</span>
            {", "}
            <span className="text-red-400">{report.summary.critical} critical</span>
          </p>
          {report.note && <p className="text-amber-400">{report.note}</p>}

          <div className="max-h-96 overflow-auto rounded border border-card-border/50">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-card-elevated">
                <tr className="border-b border-card-border text-muted">
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium">Check</th>
                  <th className="px-2 py-1.5 font-medium">Expected</th>
                  <th className="px-2 py-1.5 font-medium">Actual</th>
                  {showDriftCols && (
                    <>
                      <th className="px-2 py-1.5 font-medium">Drift</th>
                      <th className="px-2 py-1.5 font-medium">Tol</th>
                    </>
                  )}
                  <th className="px-2 py-1.5 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ key, checks }) => (
                  <Fragment key={key}>
                    <tr className="bg-card-elevated/40">
                      <td
                        colSpan={showDriftCols ? 7 : 5}
                        className="px-2 py-1 font-medium text-foreground"
                      >
                        {key}
                      </td>
                    </tr>
                    {checks.map((c) => (
                      <tr key={c.id} className="border-t border-card-border/40 align-top">
                        <td className={`px-2 py-1 ${severityColor(c.severity)}`}>{c.severity}</td>
                        <td className="px-2 py-1 text-foreground font-mono">{c.id}</td>
                        <td className="px-2 py-1 text-muted">{formatValue(c.expected)}</td>
                        <td className="px-2 py-1 text-muted">{formatValue(c.actual)}</td>
                        {showDriftCols && (
                          <>
                            <td className="px-2 py-1 text-muted">{formatPct(c.driftPct)}</td>
                            <td className="px-2 py-1 text-muted">{formatPct(c.tolerancePct)}</td>
                          </>
                        )}
                        <td className="px-2 py-1 text-muted">{c.note ?? ""}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
