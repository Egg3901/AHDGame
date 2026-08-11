"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";

interface CountryHolding {
  countryCode: string;
  faceValue: number;
  demandContribution: number;
}

interface SovereignHoldingsResponse {
  characterId: string;
  currentTurn: number;
  holdings: CountryHolding[];
}

interface Props {
  characterId: string;
}

type State =
  { kind: "loading" } | { kind: "ready"; data: SovereignHoldingsResponse } | { kind: "error" };

export function SovereignBondHoldingsPanel({ characterId }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/character/${characterId}/sovereign-holdings`);
        if (!res.ok) {
          if (!cancelled) setState({ kind: "error" });
          return;
        }
        const data = (await res.json()) as SovereignHoldingsResponse;
        if (!cancelled) setState({ kind: "ready", data });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  if (state.kind === "loading") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Sovereign Bond Holdings</h3>
        <div className="mt-2 min-h-[96px] space-y-2">
          <Skeleton className="h-3 w-3/4" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Sovereign Bond Holdings</h3>
        <p className="mt-2 text-sm text-zinc-500">Holdings unavailable</p>
      </div>
    );
  }

  const { holdings } = state.data;

  if (holdings.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-semibold">Sovereign Bond Holdings</h3>
        <p className="mt-2 text-sm text-zinc-500">No sovereign holdings</p>
      </div>
    );
  }

  const formatFace = (v: number) =>
    v >= 1_000_000_000
      ? `₳${(v / 1_000_000_000).toFixed(2)}B`
      : v >= 1_000_000
        ? `₳${(v / 1_000_000).toFixed(2)}M`
        : `₳${v.toLocaleString("en-US")}`;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">Sovereign Bond Holdings</h3>
      <p className="mt-1 text-xs text-zinc-500">
        Your contribution to each country&apos;s bond market demand signal.
      </p>
      <table className="mt-3 w-full text-xs">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="py-1">Country</th>
            <th className="py-1 text-right">Face Value</th>
            <th className="py-1 text-right">Demand +</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => (
            <tr key={h.countryCode} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1 font-medium">{h.countryCode}</td>
              <td className="py-1 text-right tabular-nums">{formatFace(h.faceValue)}</td>
              <td className="py-1 text-right tabular-nums text-emerald-600">
                +{h.demandContribution.toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
