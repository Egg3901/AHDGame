"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { CountryFlag } from "@/components/CountryFlag";
import type { CountryId } from "@/lib/constants/countries";

interface CommandEconomyRow {
  countryId: CountryId;
  countryName: string;
  regime: "command" | "dual-track";
  regimeLabel: string;
  marketizationLevel: number;
  plannedShare: number;
  monetaryOverhang: number | null;
  shortageIndex: number | null;
  blackMarketPremium: number | null;
  secondEconomyShare: number | null;
}

interface CommandEconomyPayload {
  enabled: boolean;
  currentYear: number | null;
  currentTurn: number | null;
  secondEconomyTolerance: number | null;
  rows: CommandEconomyRow[];
}

function fmtIndex(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(0);
}

function fmtPremium(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `+${(v * 100).toFixed(0)}%`;
}

function fmtShare(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

/**
 * Compact per-country command-economy observation table for admins verifying
 * the regime after enabling `commandEconomyEnabled`.
 */
export function CommandEconomyAdminPanel() {
  const [data, setData] = useState<CommandEconomyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/economy/command-economy");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div className="text-sm text-muted">Loading command-economy state…</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-card-border bg-card px-4 py-3 text-sm">
        <span className="font-semibold text-foreground">Command economy</span>
        <Badge color={data.enabled ? "success" : "default"} variant="subtle">
          {data.enabled ? "Enabled" : "Disabled"}
        </Badge>
        {data.currentYear != null && (
          <span className="text-muted">
            Year <span className="tabular-nums text-foreground">{data.currentYear}</span>
          </span>
        )}
        {data.currentTurn != null && (
          <span className="text-muted">
            Turn <span className="tabular-nums text-foreground">{data.currentTurn}</span>
          </span>
        )}
        {data.secondEconomyTolerance != null && (
          <span className="text-muted">
            Tolerance{" "}
            <span className="tabular-nums text-foreground">
              {data.secondEconomyTolerance.toFixed(2)}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={fetchData}
          className="ml-auto text-xs font-semibold text-primary hover:underline"
        >
          Refresh
        </button>
      </div>

      {!data.enabled && data.rows.length === 0 ? (
        <p className="text-sm text-muted">
          Flag is off and no planned-economy fields are persisted. Enable{" "}
          <span className="font-semibold text-foreground">commandEconomyEnabled</span> in Feature
          Gates, then advance a turn to populate overhang / shortage readouts.
        </p>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-muted">
          No scheduled planned economies are active for year {data.currentYear ?? "—"}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-card-border text-[10px] font-bold uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Country</th>
                <th className="px-3 py-2">Regime</th>
                <th className="px-3 py-2 text-right">Mktz</th>
                <th className="px-3 py-2 text-right">Plan %</th>
                <th className="px-3 py-2 text-right">Overhang</th>
                <th className="px-3 py-2 text-right">Shortage</th>
                <th className="px-3 py-2 text-right">BM premium</th>
                <th className="px-3 py-2 text-right">2nd econ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.countryId} className="border-b border-card-border/60 last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2 font-medium text-foreground">
                      <CountryFlag country={row.countryId} size="sm" />
                      {row.countryId}
                      <span className="hidden text-muted sm:inline">{row.countryName}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge color={row.regime === "command" ? "warning" : "info"} variant="subtle">
                      {row.regimeLabel}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {row.marketizationLevel}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {(row.plannedShare * 100).toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {fmtIndex(row.monetaryOverhang)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {fmtIndex(row.shortageIndex)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {fmtPremium(row.blackMarketPremium)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {fmtShare(row.secondEconomyShare)}
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

export default CommandEconomyAdminPanel;
