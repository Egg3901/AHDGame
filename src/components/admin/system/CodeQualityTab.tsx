"use client";

import { useEffect, useState } from "react";
import { CodeQualityScoreGauges } from "./CodeQualityScoreGauges";
import { CodeQualityMetricCards } from "./CodeQualityMetricCards";
import { CodeQualityTrendChart } from "./CodeQualityTrendChart";
import type { CodeQualitySnapshot } from "@/lib/db/types";

export function CodeQualityTab() {
  const [latest, setLatest] = useState<CodeQualitySnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<CodeQualitySnapshot[]>([]);
  const [environment, setEnvironment] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const envParam = environment ? `?environment=${environment}` : "";
        const [latestRes, snapshotsRes] = await Promise.all([
          fetch(`/api/admin/code-quality/snapshots/latest${envParam}`),
          fetch(
            `/api/admin/code-quality/snapshots?limit=10${environment ? `&environment=${environment}` : ""}`
          ),
        ]);

        if (latestRes.ok) {
          const data = await latestRes.json();
          setLatest(data.snapshot);
        } else {
          setLatest(null);
        }
        if (snapshotsRes.ok) {
          const data = await snapshotsRes.json();
          setSnapshots(data.snapshots);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [environment]);

  if (loading) {
    return <p className="text-sm text-muted">Loading code quality data...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted">Environment:</label>
        <select
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value);
            setLoading(true);
          }}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">All</option>
          <option value="production">Production</option>
          <option value="staging">Staging</option>
          <option value="localhost">Localhost</option>
        </select>
      </div>

      <CodeQualityScoreGauges snapshot={latest} />
      <CodeQualityMetricCards snapshot={latest} />
      <CodeQualityTrendChart snapshots={snapshots} />

      {latest && Object.keys(latest.lint.byRule).length > 0 && (
        <details className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            ESLint Rules Breakdown
          </summary>
          <div className="mt-3 max-h-60 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="p-2">Rule</th>
                  <th className="p-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(latest.lint.byRule)
                  .sort(([, a], [, b]) => b - a)
                  .map(([rule, count]) => (
                    <tr key={rule} className="border-b border-border/50">
                      <td className="p-2 font-mono">{rule}</td>
                      <td className="p-2 text-right">{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
