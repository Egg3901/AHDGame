"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CommodityData } from "@/app/country/[code]/stockmarket/types";
import { PanelState, pctText, toneClass } from "./marketUi";

export function vsBasePct(c: Pick<CommodityData, "globalPrice" | "basePrice">): number | null {
  return c.basePrice > 0 ? (c.globalPrice / c.basePrice - 1) * 100 : null;
}

function balance(c: CommodityData): { label: string; tone: string } {
  if (c.globalDemand <= 0 && c.globalSupply <= 0) return { label: "No trade", tone: "text-muted" };
  const ratio = c.globalSupply / Math.max(c.globalDemand, 1e-9);
  if (ratio < 0.95) return { label: "Short", tone: "text-error" };
  if (ratio > 1.05) return { label: "Surplus", tone: "text-success" };
  return { label: "Balanced", tone: "text-muted" };
}

export function CommoditiesPanel({
  commodities,
  loading,
  error,
  supplyEnabled,
}: {
  commodities: CommodityData[] | null;
  loading: boolean;
  error: string;
  supplyEnabled: boolean;
}) {
  const { formatPrice } = useCurrency();
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return [...(commodities ?? [])]
      .filter((c) => !needle || c.label.toLowerCase().includes(needle))
      .sort((a, b) => Math.abs(vsBasePct(b) ?? 0) - Math.abs(vsBasePct(a) ?? 0));
  }, [commodities, filter]);

  return (
    <PanelState loading={loading} error={error} empty={(commodities ?? []).length === 0}>
      <div className="space-y-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter commodities"
          aria-label="Filter commodities"
          className="h-8 w-full rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground focus:border-foreground focus:outline-none sm:w-64"
        />
        <div className="overflow-x-auto rounded-xl border border-card-border bg-card shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-body-sm text-muted">
                <th className="px-3 py-2 font-medium">Commodity</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">vs base</th>
                <th className="px-3 py-2 text-right font-medium">Change</th>
                <th className="px-3 py-2 text-right font-medium">Supply / demand</th>
                <th className="px-3 py-2 font-medium">Balance</th>
                <th className="px-3 py-2 text-right font-medium">Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const base = vsBasePct(c);
                const bal = balance(c);
                return (
                  <tr key={c.commodity} className="border-b border-card-border/50 last:border-b-0">
                    <td className="px-3 py-2 font-medium text-foreground">{c.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPrice(c.globalPrice)}
                      <span className="text-xs text-muted"> /{c.unit}</span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${toneClass(base)}`}>
                      {pctText(base)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${toneClass(c.priceChange)}`}>
                      {pctText(c.priceChange)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {Math.round(c.globalSupply).toLocaleString()} /{" "}
                      {Math.round(c.globalDemand).toLocaleString()}
                    </td>
                    <td className={`px-3 py-2 text-xs font-medium ${bal.tone}`}>{bal.label}</td>
                    <td className="px-3 py-2 text-right text-xs">
                      <Link
                        href={`/commodity/${c.commodity}`}
                        className="text-primary hover:underline"
                      >
                        Detail
                      </Link>
                      {supplyEnabled && (
                        <>
                          {" · "}
                          <Link
                            href={`/commodity/${c.commodity}/offers`}
                            className="text-primary hover:underline"
                          >
                            Offers
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PanelState>
  );
}
