"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";

interface AbuseSignal {
  type: string;
  requestCount?: number;
  threshold?: number;
  samples?: number;
  intervalMs?: number;
  coefficientOfVariation?: number;
  template?: string;
  distinctIds?: number;
}

interface AbuseFinding {
  actor: string;
  actorType: "user" | "key" | "ip";
  requestCount: number;
  windowMs: number;
  signals: AbuseSignal[];
}

interface ScanView {
  detectedAt: string | null;
  scannedRows: number | null;
  flaggedActors: number;
  findings: AbuseFinding[];
  source: "persisted" | "live";
}

function describeSignal(s: AbuseSignal): string {
  switch (s.type) {
    case "high_volume":
      return `High volume — ${s.requestCount} requests (≥ ${s.threshold})`;
    case "fixed_interval_polling":
      return `Fixed-interval polling — ~${Math.round((s.intervalMs ?? 0) / 1000)}s apart over ${s.samples} samples (cv ${s.coefficientOfVariation})`;
    case "id_enumeration":
      return `ID enumeration — ${s.distinctIds} distinct ids on ${s.template}`;
    default:
      return s.type;
  }
}

function normalize(data: Record<string, unknown>): ScanView {
  if (data.source === "persisted") {
    const scan = data.scan as Record<string, unknown> | null;
    return {
      source: "persisted",
      detectedAt: (scan?.detectedAt as string) ?? null,
      scannedRows: (scan?.scannedRows as number) ?? null,
      flaggedActors: (scan?.flaggedActors as number) ?? 0,
      findings: (scan?.findings as AbuseFinding[]) ?? [],
    };
  }
  return {
    source: "live",
    detectedAt: new Date().toISOString(),
    scannedRows: (data.scannedRows as number) ?? null,
    flaggedActors: (data.flaggedActors as number) ?? 0,
    findings: (data.findings as AbuseFinding[]) ?? [],
  };
}

export function ApiAbuseTab() {
  const [view, setView] = useState<ScanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (live: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/api-abuse${live ? "?live=1" : ""}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setView(normalize(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">API Abuse</h2>
        <p className="mt-0.5 text-xs text-muted">
          Scraping / enumeration / polling patterns in API traffic. Report-only — nothing is
          throttled or blocked.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-xs text-muted">
          {view?.detectedAt ? (
            <>
              {view.source === "live" ? "Live scan" : "Last scan"}:{" "}
              <LocalTime value={view.detectedAt} />
              {view.scannedRows != null ? ` · ${view.scannedRows} requests scanned` : ""}
            </>
          ) : (
            "No scan has run yet."
          )}
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Re-scan now"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {!loading && view && view.findings.length === 0 && (
        <div className="rounded-md border border-card-border bg-card px-4 py-8 text-center text-sm text-muted">
          No abuse patterns flagged in this window.
        </div>
      )}

      {view && view.findings.length > 0 && (
        <div className="overflow-hidden rounded-md border border-card-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-card-border text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Actor</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Requests</th>
                <th className="px-4 py-2 font-medium">Signals</th>
              </tr>
            </thead>
            <tbody>
              {view.findings.map((f) => (
                <tr key={`${f.actorType}:${f.actor}`} className="border-b border-card-border/50">
                  <td className="px-4 py-2 font-mono text-xs">{f.actor}</td>
                  <td className="px-4 py-2">
                    <span className="rounded bg-background px-1.5 py-0.5 text-xs">
                      {f.actorType}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{f.requestCount}</td>
                  <td className="px-4 py-2">
                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                      {f.signals.map((s, i) => (
                        <li key={i}>{describeSignal(s)}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
