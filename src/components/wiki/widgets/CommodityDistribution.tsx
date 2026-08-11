// src/components/wiki/widgets/CommodityDistribution.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";

interface CountryDistribution {
  countryId: "US" | "UK" | "DE" | "JP";
  name: string;
  flagEmoji: string;
  supply: number;
  demand: number;
  net: number;
  capacity?: number;
}

interface TopProducerState {
  stateId: string;
  name: string;
  countryId: "US" | "UK" | "DE" | "JP";
  capacity: number;
}

interface DistributionData {
  commodity: string;
  label: string;
  basePrice: number;
  globalPrice: number;
  unit: string;
  isExtractable: boolean;
  byCountry: CountryDistribution[];
  topProducerStates: TopProducerState[];
  turn: number | null;
  updatedAt: string | null;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(abs < 10 ? 2 : 0);
}

export function CommodityDistribution({ data: rawType }: { data?: string }) {
  const commodityType = (rawType ?? "").trim().toLowerCase();
  const [data, setData] = useState<DistributionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!commodityType) {
      setError("No commodity type specified");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/wiki/commodity-distribution/${encodeURIComponent(commodityType)}`
        );
        if (!res.ok) {
          if (res.status === 400) throw new Error("Unknown commodity");
          throw new Error("Unable to load distribution");
        }
        const json = (await res.json()) as DistributionData;
        if (cancelled) return;
        setData(json);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load distribution");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [commodityType]);

  if (loading) {
    return (
      <div className="my-4 rounded-xl border border-card-border bg-card/40 p-6">
        <div className="h-32 animate-pulse space-y-3">
          <div className="h-4 w-40 rounded bg-card-elevated" />
          <div className="h-6 w-full rounded bg-card-elevated" />
          <div className="h-6 w-full rounded bg-card-elevated" />
          <div className="h-6 w-2/3 rounded bg-card-elevated" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="my-4 rounded-xl border border-card-border bg-card/40 p-6">
        <p className="text-sm text-muted">{error ?? "No distribution data available"}</p>
      </div>
    );
  }

  // Biggest net exporter is the country with the largest positive net.
  const maxAbs = data.byCountry.reduce((max, c) => Math.max(max, Math.abs(c.net)), 0);

  return (
    <div className="my-4 space-y-4 rounded-xl border border-card-border bg-card/40 p-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Live distribution
          </p>
          <h3 className="mt-0.5 font-semibold text-foreground">{data.label}</h3>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">Global price</p>
          <p className="font-mono text-base text-foreground">
            ${formatNumber(data.globalPrice)}
            <span className="ml-1 text-xs text-muted">/ {data.unit}</span>
          </p>
          <p className="text-xs text-muted">base ${formatNumber(data.basePrice)}</p>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border/60 text-xs uppercase tracking-wider text-muted">
              <th className="py-2 pr-3 text-left font-semibold">Country</th>
              <th className="py-2 px-3 text-right font-semibold">Supply</th>
              <th className="py-2 px-3 text-right font-semibold">Demand</th>
              <th className="py-2 pl-3 text-right font-semibold">Net</th>
              {data.isExtractable && (
                <th className="py-2 pl-3 text-right font-semibold">Capacity</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.byCountry.map((c) => {
              const share = maxAbs > 0 ? Math.abs(c.net) / maxAbs : 0;
              const isExporter = c.net >= 0;
              return (
                <tr key={c.countryId} className="border-b border-card-border/30 last:border-b-0">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/wiki/${c.countryId.toLowerCase()}-overview`}
                      className="group flex items-center gap-2 hover:text-primary"
                    >
                      <CountryFlag country={c.countryId} size="sm" />
                      <span className="font-medium text-foreground group-hover:text-primary">
                        {c.name}
                      </span>
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-foreground">
                    {formatNumber(c.supply)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-muted">
                    {formatNumber(c.demand)}
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-card-elevated" aria-hidden>
                        <div
                          className={`h-full rounded-full ${isExporter ? "bg-success/70" : "bg-error/70"}`}
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                      </div>
                      <span
                        className={`font-mono text-sm ${isExporter ? "text-success" : "text-error"}`}
                      >
                        {isExporter ? "+" : ""}
                        {formatNumber(c.net)}
                      </span>
                    </div>
                  </td>
                  {data.isExtractable && (
                    <td className="py-2 pl-3 text-right font-mono text-foreground">
                      {formatNumber(c.capacity ?? 0)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.isExtractable && data.topProducerStates.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Top producing regions
          </p>
          <ul className="space-y-1 text-sm">
            {data.topProducerStates.map((s) => (
              <li
                key={s.stateId}
                className="flex items-center justify-between rounded bg-card-elevated/60 px-3 py-1.5"
              >
                <span className="text-foreground">
                  <span className="mr-2 text-xs text-muted">{s.countryId}</span>
                  {s.name}
                </span>
                <span className="font-mono text-muted">
                  {formatNumber(s.capacity)} {data.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <Link href={`/commodity/${data.commodity}`} className="hover:text-primary hover:underline">
          View full market page →
        </Link>
        {data.turn != null && <span>Turn {data.turn}</span>}
      </footer>
    </div>
  );
}
