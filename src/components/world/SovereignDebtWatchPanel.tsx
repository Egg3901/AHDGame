"use client";

/**
 * Pre-crisis warning dashboard panel — renders on /world/crises.
 *
 * Self-fetches /api/world/sovereign-watch on mount. Displays a sortable
 * table with each country's crisis state, demand ratio, DSA score + band,
 * failed-auction streak, and turns-since-last-default. Color-codes rows
 * by combined risk so speculators can spot deteriorating countries early.
 */
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";

interface DsaPayload {
  score: number;
  band: "healthy" | "warning" | "at-risk" | "crisis";
  components: { id: string; label: string; contribution: number }[];
}

interface SovereignWatchRow {
  countryCode: string;
  countryName: string;
  crisisState: string;
  demandRatio: number | null;
  dsa: DsaPayload | null;
  failedAuctionConsecutiveCount: number;
  turnsSinceLastDefault: number | null;
}

interface SovereignWatchResponse {
  currentTurn: number;
  rows: SovereignWatchRow[];
}

function rowAccent(row: SovereignWatchRow): string {
  if (row.crisisState === "crisisPending" || row.crisisState === "crisisResolving") {
    return "border-rose-500/60 bg-rose-500/5";
  }
  if (row.dsa?.band === "crisis") return "border-rose-500/40 bg-rose-500/5";
  if (row.dsa?.band === "at-risk") return "border-orange-500/40 bg-orange-500/5";
  if (row.dsa?.band === "warning") return "border-amber-500/40 bg-amber-500/5";
  return "border-card-border";
}

function crisisStateLabel(state: string): string {
  switch (state) {
    case "normal":
      return "Stable";
    case "crisisPending":
      return "Crisis — pending";
    case "crisisResolving":
      return "Crisis — resolving";
    case "recovering":
      return "Recovering";
    default:
      return state;
  }
}

function dsaColor(band: DsaPayload["band"] | undefined): string {
  if (band === "healthy") return "text-emerald-600 dark:text-emerald-400";
  if (band === "warning") return "text-amber-600 dark:text-amber-400";
  if (band === "at-risk") return "text-orange-600 dark:text-orange-400";
  if (band === "crisis") return "text-rose-600 dark:text-rose-400";
  return "text-zinc-500 dark:text-zinc-400";
}

function demandColor(ratio: number | null): string {
  if (ratio === null) return "text-zinc-500 dark:text-zinc-400";
  if (ratio >= 1.0) return "text-emerald-600 dark:text-emerald-400";
  if (ratio >= 0.7) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export function SovereignDebtWatchPanel() {
  const [data, setData] = useState<SovereignWatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/world/sovereign-watch");
        if (!res.ok) {
          if (!cancelled) setError(`Failed to load (${res.status})`);
          return;
        }
        const body = (await res.json()) as SovereignWatchResponse;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <section className="rounded-lg border border-card-border bg-card p-4">
        <h2 className="text-sm font-semibold">Sovereign Debt Watch</h2>
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="rounded-lg border border-card-border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Sovereign Debt Watch</h2>
          <Skeleton className="h-3 w-14" />
        </div>
        <Skeleton className="mt-2 h-3 w-4/5" />
        <div className="mt-3 min-h-[220px] space-y-2.5">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="ml-auto h-3.5 w-40" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Sort by combined risk: highest crisis → lowest DSA score first.
  const sortedRows = [...data.rows].sort((a, b) => {
    const aRisk = a.crisisState === "crisisPending" || a.crisisState === "crisisResolving" ? 1 : 0;
    const bRisk = b.crisisState === "crisisPending" || b.crisisState === "crisisResolving" ? 1 : 0;
    if (aRisk !== bRisk) return bRisk - aRisk;
    return (a.dsa?.score ?? 100) - (b.dsa?.score ?? 100);
  });

  return (
    <section className="rounded-lg border border-card-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Sovereign Debt Watch</h2>
        <span className="text-xs text-muted">Turn {data.currentTurn}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Forward-looking sustainability indicators across every country. Sustainability index
        combines D/GDP, primary balance, FX depreciation, and growth.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-card-border text-left text-muted">
            <tr>
              <th className="py-1">Country</th>
              <th className="py-1">State</th>
              <th className="py-1 text-right">Demand</th>
              <th className="py-1 text-right">DSA</th>
              <th className="py-1 text-right">Auctions</th>
              <th className="py-1 text-right">Last default</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={row.countryCode}
                className={`border-t border-card-border/40 ${rowAccent(row)}`}
              >
                <td className="py-1 font-medium">
                  {row.countryName} <span className="text-xs text-muted">({row.countryCode})</span>
                </td>
                <td className="py-1 text-muted">{crisisStateLabel(row.crisisState)}</td>
                <td
                  className={`py-1 text-right tabular-nums ${demandColor(row.demandRatio)}`}
                  title={row.demandRatio === null ? "No bond-auction data yet" : undefined}
                >
                  {row.demandRatio !== null ? row.demandRatio.toFixed(2) : "—"}
                </td>
                <td
                  className={`py-1 text-right tabular-nums ${dsaColor(row.dsa?.band)}`}
                  title={row.dsa ? undefined : "No sustainability data yet"}
                >
                  {row.dsa ? `${row.dsa.score.toFixed(0)} (${row.dsa.band})` : "—"}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {row.failedAuctionConsecutiveCount} / 3
                </td>
                <td className="py-1 text-right tabular-nums">
                  {row.turnsSinceLastDefault !== null
                    ? `${row.turnsSinceLastDefault}t ago`
                    : "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
