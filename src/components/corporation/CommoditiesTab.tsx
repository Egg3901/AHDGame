"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorpCommodityFlow, CorpCommodityRegion } from "@/lib/corporations/corpCommodityFlows";
import type { CorpMarketSharePosition } from "@/lib/corporations/corpMarketShare";

interface CommoditiesResponse {
  clearingEnabled: boolean;
  ledgerEnabled?: boolean;
  brandLoyaltyEnabled?: boolean;
  brandLoyaltySliceEnabled?: boolean;
  sectorQualityEnabled?: boolean;
  supplyAgreementsEnabled?: boolean;
  commodities: CorpCommodityFlow[];
  regions: CorpCommodityRegion[];
  marketShare?: CorpMarketSharePosition[];
  isPrivate?: boolean;
}

/** Compact unit formatter — thousands separators, at most one decimal. */
function fmtUnits(n: number): string {
  const abs = Math.abs(n);
  const decimals = abs > 0 && abs < 10 ? 1 : 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

/**
 * Corporation-level commodity flows: what this corporation produces and
 * consumes each turn, global stockpile context, CEO actions, and regional breakdown.
 */
export default function CommoditiesTab({
  corpId,
  isCeo = false,
  modViewEnabled = false,
}: {
  corpId: string;
  loading?: boolean;
  isCeo?: boolean;
  modViewEnabled?: boolean;
}) {
  const { formatAmount } = useCurrency();
  const [data, setData] = useState<CommoditiesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const url = modViewEnabled
          ? `/api/corporations/${corpId}/commodities?modView=1`
          : `/api/corporations/${corpId}/commodities`;
        const res = await fetch(url);
        if (res.ok && !cancelled) setData(await res.json());
      } catch {
        // ignore — render empty state below
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [corpId, modViewEnabled]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-xl rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const commodities = data?.commodities ?? [];
  const regions = data?.regions ?? [];
  const producers = commodities.filter((c) => c.outputUnits > 0);

  if (commodities.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center space-y-2">
        <p className="text-sm font-semibold text-foreground">Commodity flows</p>
        <p className="text-sm text-muted max-w-lg mx-auto">
          {data?.isPrivate
            ? "Commodity flows are not disclosed for private corporations."
            : "This corporation isn't producing or consuming any commodities yet."}
        </p>
      </div>
    );
  }

  const showMarketFlags =
    data?.brandLoyaltyEnabled ||
    data?.sectorQualityEnabled ||
    data?.supplyAgreementsEnabled ||
    data?.clearingEnabled;

  return (
    <div className="space-y-6">
      {showMarketFlags && (
        <div className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Active market features</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {data?.clearingEnabled && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                Posted pricing (clearing)
              </span>
            )}
            {data?.brandLoyaltyEnabled && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                Brand loyalty
                {data.brandLoyaltySliceEnabled ? " (live in clearing)" : " (shadow accrual)"}
              </span>
            )}
            {data?.sectorQualityEnabled && (
              <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-1 text-[11px] font-medium text-teal-400">
                Output quality
              </span>
            )}
            {data?.supplyAgreementsEnabled && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                Supply agreements
              </span>
            )}
          </div>
          {isCeo && data?.supplyAgreementsEnabled && (
            <p className="mt-2 text-xs text-muted">
              Propose private supply deals from the{" "}
              <Link
                href={`/corporation/${corpId}?tab=ownership&sub=structure`}
                className="text-primary hover:underline"
              >
                Structure
              </Link>{" "}
              tab.
            </p>
          )}
        </div>
      )}

      {/* Global stockpile snapshot for commodities this corp produces */}
      {data?.ledgerEnabled && producers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Current global stockpile</h3>
          <p className="text-xs text-muted">
            Shadow inventory from the market ledger — world-level, not corp-owned. See Charts →
            Market Share for stockpile over time.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {producers.map((c) => (
              <div
                key={`stock-${c.commodity}`}
                className="rounded-xl border border-card-border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-bold ${c.color}`}
                  >
                    {c.icon}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{c.label}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      Stock
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {c.market.stockUnits != null
                        ? `${fmtUnits(c.market.stockUnits)} ${c.unit}`
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      Cover
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">
                      {c.market.coverTurns != null
                        ? `${c.market.coverTurns.toFixed(1)} turns`
                        : "—"}
                    </div>
                  </div>
                </div>
                {(c.market.surplusUnits != null || c.market.unmetDemandUnits != null) && (
                  <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    {c.market.surplusUnits != null && c.market.surplusUnits > 0 && (
                      <span>Surplus: {fmtUnits(c.market.surplusUnits)}</span>
                    )}
                    {c.market.unmetDemandUnits != null && c.market.unmetDemandUnits > 0 && (
                      <span className="text-amber-400">
                        Unmet: {fmtUnits(c.market.unmetDemandUnits)}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2 border-t border-card-border pt-2">
                  <Link
                    href={`/commodity/${c.commodity}`}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    Market page →
                  </Link>
                  <Link
                    href={`/corporation/${corpId}?tab=charts`}
                    className="text-[11px] font-medium text-muted hover:text-foreground"
                  >
                    History chart →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-commodity flows */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Per-turn commodity flows</h3>
        <p className="text-xs text-muted">
          Net production is this corporation&apos;s own output minus its input use. Purchases do not
          change it. The private-supply box shows where consumed inputs came from.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {commodities.map((c) => (
            <div key={c.commodity} className="rounded-xl border border-card-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[10px] font-bold ${c.color}`}
                  >
                    {c.icon}
                  </span>
                  <span className="truncate text-sm font-semibold text-foreground">{c.label}</span>
                </div>
                {c.market.price != null && (
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {formatAmount(c.market.price)}/{c.unit}
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Output
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-emerald-400">
                    {c.outputUnits > 0 ? fmtUnits(c.outputUnits) : "—"}
                  </div>
                  {/* Revenue: physical output valued at the current market price (per turn). */}
                  {c.market.price != null && (
                    <div className="mt-0.5 text-[11px] tabular-nums text-muted">
                      {c.outputUnits > 0 ? formatAmount(c.outputUnits * c.market.price) : "—"}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Consumed
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-amber-400">
                    {c.consumptionUnits > 0 ? fmtUnits(c.consumptionUnits) : "—"}
                  </div>
                  {/* Input cost: consumption valued at the current market price (per turn). */}
                  {c.market.price != null && (
                    <div className="mt-0.5 text-[11px] tabular-nums text-muted">
                      {c.consumptionUnits > 0
                        ? formatAmount(c.consumptionUnits * c.market.price)
                        : "—"}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Net production
                  </div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      c.netUnits >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {c.netUnits >= 0 ? "+" : ""}
                    {fmtUnits(c.netUnits)}
                  </div>
                  {/* Net production valued at the current market price per turn. */}
                  {c.market.price != null && (
                    <div
                      className={`mt-0.5 text-[11px] tabular-nums ${
                        c.netUnits >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {c.netUnits >= 0 ? "+" : ""}
                      {formatAmount(c.netUnits * c.market.price)}
                    </div>
                  )}
                </div>
              </div>

              {c.privateSupply && (
                <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Private supply
                  </div>
                  <div className="mt-1 text-xs font-medium text-foreground tabular-nums">
                    {fmtUnits(c.privateSupply.consumptionCoveredUnits)} of{" "}
                    {fmtUnits(c.privateSupply.consumptionUnits)} {c.unit} consumed came from private
                    supply.
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {fmtUnits(
                      Math.max(
                        0,
                        c.privateSupply.consumptionUnits - c.privateSupply.consumptionCoveredUnits
                      )
                    )}{" "}
                    {c.unit} came from the open market or other sources.
                  </div>
                  <div className="mt-1 text-[11px] text-muted tabular-nums">
                    Delivered on turn {c.privateSupply.turn}.{" "}
                    {fmtUnits(c.privateSupply.coveragePercent)}% covered. Contracted cap:{" "}
                    {fmtUnits(c.privateSupply.contractedUnits)} {c.unit}/turn.
                  </div>
                  {c.privateSupply.previousTurn !== undefined &&
                    c.privateSupply.previousDeliveredUnits !== undefined &&
                    c.privateSupply.previousConsumptionUnits !== undefined && (
                      <div className="mt-2 text-[11px] text-muted tabular-nums">
                        Previous turn {c.privateSupply.previousTurn}:{" "}
                        {fmtUnits(c.privateSupply.previousDeliveredUnits)} delivered against{" "}
                        {fmtUnits(c.privateSupply.previousConsumptionUnits)} consumed.
                      </div>
                    )}
                  <div className="mt-2 text-[11px] text-muted">
                    Delivery can be below the cap when the supplier cannot cover all active
                    agreements or when your corporation consumes less. Scarce supplier output is
                    divided proportionally across active agreements.
                  </div>
                </div>
              )}

              {!data?.ledgerEnabled &&
                (c.market.stockUnits != null || c.market.coverTurns != null) && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-card-border pt-2 text-[11px] text-muted">
                    {c.market.stockUnits != null && (
                      <span>
                        Global stock:{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {fmtUnits(c.market.stockUnits)} {c.unit}
                        </span>
                      </span>
                    )}
                    {c.market.coverTurns != null && (
                      <span>
                        Cover:{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {c.market.coverTurns.toFixed(1)} turns
                        </span>
                      </span>
                    )}
                  </div>
                )}

              <div className="mt-3 flex flex-wrap gap-2 border-t border-card-border pt-2">
                <Link
                  href={`/commodity/${c.commodity}`}
                  className="rounded-md border border-card-border bg-card-elevated px-2 py-1 text-[11px] font-medium text-foreground hover:bg-card"
                >
                  View market
                </Link>
                {isCeo &&
                  data?.clearingEnabled &&
                  c.outputSectors &&
                  c.outputSectors.length > 0 && (
                    <>
                      {c.outputSectors.map((s) => (
                        <Link
                          key={s.sectorId}
                          href={`/corporation/${corpId}/sector/${s.sectorId}`}
                          className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15"
                        >
                          Pricing: {s.label}
                        </Link>
                      ))}
                    </>
                  )}
                {isCeo && data?.supplyAgreementsEnabled && c.outputUnits > 0 && (
                  <Link
                    href={`/corporation/${corpId}?tab=ownership&sub=structure`}
                    className="rounded-md border border-card-border bg-card-elevated px-2 py-1 text-[11px] font-medium text-muted hover:text-foreground"
                  >
                    Supply deal
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Regional breakdown */}
      {regions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">By region</h3>
          <div className="space-y-3">
            {regions.map((r) => (
              <div key={r.stateId} className="rounded-xl border border-card-border bg-card p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{r.stateName}</span>
                  {r.region && (
                    <span className="text-[11px] uppercase tracking-wider text-muted">
                      {r.region}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.rows.map((row) => (
                    <span
                      key={row.commodity}
                      className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-elevated px-2.5 py-1 text-xs"
                    >
                      <span className="font-medium text-foreground">{row.label}</span>
                      {row.outputUnits > 0 && (
                        <span className="text-emerald-400 tabular-nums">
                          ▲{fmtUnits(row.outputUnits)}
                        </span>
                      )}
                      {row.consumptionUnits > 0 && (
                        <span className="text-amber-400 tabular-nums">
                          ▼{fmtUnits(row.consumptionUnits)}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
