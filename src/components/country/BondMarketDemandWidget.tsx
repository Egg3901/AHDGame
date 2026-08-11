"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import type { SovereignDemandResult, SovereignDemandSnapshot } from "@/lib/sovereignDefault/types";
import type { DsaResult } from "@/lib/sovereignDefault/debtSustainability";

interface SovereignStatusResponse {
  countryCode: string;
  currentTurn: number;
  snapshot: SovereignDemandSnapshot;
  demand: SovereignDemandResult;
  dsa?: DsaResult;
}

interface Props {
  countryCode: string;
  /** Optional display name shown alongside the heading (e.g. "United States"). */
  countryLabel?: string;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: SovereignStatusResponse }
  | { kind: "error"; message: string };

export function BondMarketDemandWidget({ countryCode, countryLabel }: Props) {
  const heading = countryLabel ? `${countryLabel} — Bond Market Demand` : "Bond Market Demand";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/country/${countryCode}/sovereign-status`);
        if (!res.ok) {
          if (!cancelled) setState({ kind: "error", message: "Demand signal not available" });
          return;
        }
        const data = (await res.json()) as SovereignStatusResponse;
        if (!cancelled) setState({ kind: "ready", data });
      } catch (err) {
        if (!cancelled)
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to load",
          });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  if (state.kind === "loading") {
    return (
      <div className="rounded-lg border border-card-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
        <div className="mt-2 min-h-[160px]">
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="mt-2 h-3 w-40" />
          <div className="mt-3 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-card-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
        <p className="mt-2 text-sm text-muted">{state.message || "Demand signal not available"}</p>
      </div>
    );
  }

  const { demand, dsa } = state.data;
  const ratio = demand.demandRatio;
  const ratioColor =
    ratio >= 1.0
      ? "text-emerald-600 dark:text-emerald-400"
      : ratio >= 0.7
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400";
  const dsaColor =
    dsa?.band === "healthy"
      ? "text-emerald-600 dark:text-emerald-400"
      : dsa?.band === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : dsa?.band === "at-risk"
          ? "text-orange-600 dark:text-orange-400"
          : "text-rose-600 dark:text-rose-400";

  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${ratioColor}`}>{ratio.toFixed(2)}</span>
        <span className="text-xs text-muted">demand ratio</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {ratio >= 1.0
          ? "Full subscription expected"
          : ratio >= 0.7
            ? "Undersubscribed — yields rising"
            : "Failed-auction territory"}
      </p>
      {dsa ? (
        <div className="mt-2 flex items-baseline justify-between border-t border-card-border pt-2">
          <span className="text-xs text-muted">Sustainability index</span>
          <span className={`text-sm font-bold tabular-nums ${dsaColor}`}>
            {dsa.score.toFixed(0)} / 100{" "}
            <span className="ml-1 text-xs font-normal text-muted">({dsa.band})</span>
          </span>
        </div>
      ) : null}
      <table className="mt-3 w-full text-xs">
        <tbody>
          {demand.components.map((c) => (
            <tr key={c.id} className="border-t border-card-border">
              <td className="py-1 text-muted">{c.label}</td>
              <td
                className={`py-1 text-right tabular-nums ${
                  c.contribution > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : c.contribution < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-muted"
                }`}
              >
                {c.contribution >= 0 ? "+" : ""}
                {c.contribution.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
