"use client";

import { useEffect, useState, useCallback } from "react";

interface Warning {
  turn: number;
  phase: string;
  severity: "warning" | "error";
  message: string;
  source: "turnProcessing" | "integrity" | "turnLock" | "turnPhase" | "phaseBudget";
  timestamp: string;
}

const severityClasses = {
  error: "bg-error/10 text-error",
  warning: "bg-warning/10 text-warning",
} as const;

const sourceLabels = {
  turnProcessing: "Turn",
  integrity: "Integrity",
  turnLock: "Turn Lock",
  turnPhase: "Phase Status",
  phaseBudget: "Phase Budget",
} as const;

const sourceClasses = {
  turnProcessing: "bg-secondary/10 text-secondary",
  integrity: "bg-warning/10 text-warning",
  turnLock: "bg-error/10 text-error",
  turnPhase: "bg-primary/10 text-primary",
  // Amber like Integrity: a phase nearing the timeout is a lead-time signal,
  // not yet a failure.
  phaseBudget: "bg-warning/10 text-warning",
} as const;

export function GameHealthWarningsLog() {
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [loading, setLoading] = useState(true);
  const [phaseFilter, setPhaseFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const fetchWarnings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (phaseFilter) params.set("phase", phaseFilter);
      if (severityFilter) params.set("severity", severityFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      const res = await fetch(`/api/admin/health/warnings?${params}`);
      if (res.ok) {
        const data = await res.json();
        setWarnings(data.warnings);
      }
    } finally {
      setLoading(false);
    }
  }, [phaseFilter, severityFilter, sourceFilter]);

  useEffect(() => {
    fetchWarnings();
  }, [fetchWarnings]);

  const uniquePhases = [...new Set(warnings.map((w) => w.phase))].sort();

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Warnings & Errors</h3>

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={phaseFilter}
          onChange={(e) => setPhaseFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All Phases</option>
          {uniquePhases.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All Severity</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">All Sources</option>
          <option value="turnProcessing">Turn</option>
          <option value="integrity">Integrity</option>
          <option value="turnLock">Turn Lock</option>
          <option value="turnPhase">Phase Outcomes</option>
          <option value="phaseBudget">Phase Budget</option>
        </select>
      </div>

      {loading ? (
        <p className="text-xs text-muted">Loading...</p>
      ) : warnings.length === 0 ? (
        <p className="text-xs text-muted">No warnings or errors found.</p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className="p-2">Turn</th>
                <th className="p-2">Phase</th>
                <th className="p-2">Source</th>
                <th className="p-2">Severity</th>
                <th className="p-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {warnings.map((w, i) => (
                <tr key={`${w.turn}-${w.phase}-${i}`} className="border-b border-border/50">
                  <td className="p-2 font-mono">{w.turn}</td>
                  <td className="p-2">{w.phase}</td>
                  <td className="p-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${sourceClasses[w.source]}`}
                    >
                      {sourceLabels[w.source]}
                    </span>
                  </td>
                  <td className="p-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${severityClasses[w.severity]}`}
                    >
                      {w.severity}
                    </span>
                  </td>
                  <td className="max-w-md truncate p-2" title={w.message}>
                    {w.message}
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
