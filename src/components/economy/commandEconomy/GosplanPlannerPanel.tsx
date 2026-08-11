"use client";

import { useState } from "react";
import { Badge, Button, Tooltip } from "@/components/ui";
import { formatCompactNumber } from "@/lib/utils/formatters";
import { CE_TERMS } from "./glossary";
import type { CommandEconomyDashboard } from "@/lib/economy/commandEconomyDashboard";

interface Props {
  dashboard: CommandEconomyDashboard;
  onSaved: () => void;
}

/**
 * Gosplan Planner panel — allocates the national plan: an output quota for
 * every state enterprise. The quotas are what directors execute against and
 * what the engine scores fulfillment and sizes credit from. Writes soe.planTarget.
 */
export function GosplanPlannerPanel({ dashboard, onSaved }: Props) {
  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const s of dashboard.soes) seed[s.corpId] = String(Math.round(s.planTarget));
    return seed;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const numeric: Record<string, number> = {};
      for (const [corpId, raw] of Object.entries(targets)) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) numeric[corpId] = n;
      }
      const res = await fetch(
        `/api/country/${dashboard.countryId.toLowerCase()}/command-economy/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets: numeric }),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const shortfalls = dashboard.soes.filter((s) => s.planFulfillment < 0.9).length;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center text-sm font-bold text-foreground">
          Gosplan Planner
          <Tooltip content={CE_TERMS.gosplan} label="About Gosplan" />
        </h3>
        <Badge color="warning" variant="subtle">
          National plan
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">
        Set the output quota for every enterprise. Over-ambition breeds shortage, slack wastes
        capacity. The balancing act is heavy industry against consumer goods.
      </p>

      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        <span className="text-muted">
          Aggregate fulfillment{" "}
          <span className="font-bold tabular-nums text-foreground">
            {Math.round(dashboard.aggregateFulfillment * 100)}%
          </span>
        </span>
        {shortfalls > 0 && (
          <span className="text-warning">
            {shortfalls} {shortfalls === 1 ? "sector" : "sectors"} under quota
          </span>
        )}
      </div>

      {/* Mobile (below sm): stacked cards so the editable quota is always
          reachable without a horizontal scroll clipping the input column. */}
      <div className="mt-4 space-y-3 sm:hidden">
        {dashboard.soes.map((s) => {
          const under = s.planFulfillment < 0.9;
          return (
            <div key={s.corpId} className="rounded-lg border border-card-border/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{s.sectorLabel}</span>
                <span
                  className={`text-xs font-semibold tabular-nums ${
                    under ? "text-warning" : "text-success"
                  }`}
                >
                  {Math.round(s.planFulfillment * 100)}% of plan
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                Output{" "}
                <span className="tabular-nums text-foreground">
                  {formatCompactNumber(s.output)}
                </span>
              </div>
              <label className="mt-2 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted">
                  Quota
                </span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={targets[s.corpId] ?? ""}
                  onChange={(e) => setTargets((t) => ({ ...t, [s.corpId]: e.target.value }))}
                  className="w-full flex-1 rounded-md border border-card-border bg-card px-2 py-1.5 text-right text-sm tabular-nums text-foreground focus:border-primary focus:outline-none"
                />
              </label>
            </div>
          );
        })}
      </div>

      {/* Desktop (sm and up): compact table. */}
      <div className="mt-4 hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-card-border text-[10px] font-bold uppercase tracking-wide text-muted">
              <th className="px-2 py-2">Sector</th>
              <th className="px-2 py-2 text-right">Output</th>
              <th className="px-2 py-2 text-right">Fulfillment</th>
              <th className="px-2 py-2 text-right">Quota</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.soes.map((s) => {
              const under = s.planFulfillment < 0.9;
              return (
                <tr key={s.corpId} className="border-b border-card-border/50 last:border-b-0">
                  <td className="px-2 py-2 font-medium text-foreground">{s.sectorLabel}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">
                    {formatCompactNumber(s.output)}
                  </td>
                  <td
                    className={`px-2 py-2 text-right tabular-nums font-semibold ${
                      under ? "text-warning" : "text-success"
                    }`}
                  >
                    {Math.round(s.planFulfillment * 100)}%
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={targets[s.corpId] ?? ""}
                      onChange={(e) => setTargets((t) => ({ ...t, [s.corpId]: e.target.value }))}
                      className="w-28 rounded-md border border-card-border bg-card px-2 py-1 text-right text-sm tabular-nums text-foreground focus:border-primary focus:outline-none"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-3 text-xs text-error">{error}</p>}
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Set plan quotas"}
        </Button>
      </div>
    </div>
  );
}

export default GosplanPlannerPanel;
