"use client";

import { useWorldFlags } from "@/hooks/useWorldFlags";
import { useEffect, useState } from "react";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import {
  getOperatingSectorType,
  getSectorStrategies,
  getStrategyForOperatingModel,
  STRATEGY_COOLDOWN_TURNS,
  STRATEGY_RETOOL_COST_FRACTION,
  STRATEGY_TRANSITION_MARGIN_PENALTY,
  STRATEGY_TRANSITION_TURNS,
  type SectorStrategy,
} from "@/lib/constants/sectorStrategies";
import {
  COMMODITY_LABELS,
  COMMODITY_ICONS,
  COMMODITY_LOG_K,
  COMMODITY_PER_ITEM_CAP,
  computeEffectiveCommodityPressureRatio,
  type CommodityType,
} from "@/lib/constants/commodities";
import { useCurrency } from "@/contexts/CurrencyContext";
import { fetchJson } from "@/lib/observability/fetchJson";

interface StrategyChangeConfirmProps {
  sectorType: OperatingSectorType;
  /** Manufacturing production model (vehicles) of the persisted sector. */
  industryModel?: string | null;
  /** Media lane discriminator (entertainment) of the persisted sector. */
  mediaDiscriminator?: string | null;
  mediaOperatingModelsEnabled?: boolean;
  currentStrategyId: string;
  targetStrategyId: string;
  /** Sector revenue in the corp's liquidCurrencyCode (post-v0.2.6). */
  dailyRevenue: number;
  /** Corp's liquidCurrencyCode — drives formatAmount wallet-pref display. */
  liquidCurrencyCode?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

type MarketStatus = "oversupplied" | "balanced" | "undersupplied";
type CommodityMarket = { globalSupply: number; globalDemand: number };

/** Rates are shares of output; show them as units per 100 units of output. */
function per100(rate: number): string {
  return String(Math.round(rate * 100));
}

function getMarketStatus(supply: number, demand: number): MarketStatus {
  if (supply <= 0 && demand <= 0) return "balanced";
  const ratio = demand / Math.max(supply, 0.01);
  if (ratio > 1.05) return "undersupplied";
  if (ratio < 0.95) return "oversupplied";
  return "balanced";
}

const STATUS_STYLE: Record<MarketStatus, string> = {
  oversupplied: "text-warning",
  balanced: "text-success",
  undersupplied: "text-error",
};

const STATUS_LABEL: Record<MarketStatus, string> = {
  oversupplied: "surplus",
  balanced: "balanced",
  undersupplied: "shortage",
};

/**
 * Estimate commodity margin modifier for a set of supply/demand rates
 * using global market data. Simplified version of server-side computation
 * (global-only, no state blending — close enough for a preview).
 */
function estimateCommodityMargin(
  supplyRates: Partial<Record<CommodityType, number>>,
  demandRates: Partial<Record<CommodityType, number>>,
  marketData: Record<string, CommodityMarket>
): number {
  let margin = 0;

  // Surplus bonus for outputs (selling into demand)
  for (const [commodity, rate] of Object.entries(supplyRates)) {
    const m = marketData[commodity];
    if (!m || !rate) continue;
    const pressure = computeEffectiveCommodityPressureRatio(m.globalSupply, m.globalDemand);
    const per = COMMODITY_LOG_K * rate * Math.log(pressure);
    margin += Math.max(-COMMODITY_PER_ITEM_CAP, Math.min(COMMODITY_PER_ITEM_CAP, per));
  }

  // Input cost modifier for inputs (buying from supply)
  for (const [commodity, rate] of Object.entries(demandRates)) {
    const m = marketData[commodity];
    if (!m || !rate) continue;
    const pressure = computeEffectiveCommodityPressureRatio(m.globalSupply, m.globalDemand);
    const per = -COMMODITY_LOG_K * rate * Math.log(pressure);
    margin += Math.max(-COMMODITY_PER_ITEM_CAP, Math.min(COMMODITY_PER_ITEM_CAP, per));
  }

  return Math.round(margin * 10) / 10;
}

export default function StrategyChangeConfirm({
  sectorType,
  industryModel,
  mediaDiscriminator,
  mediaOperatingModelsEnabled,
  currentStrategyId,
  targetStrategyId,
  dailyRevenue,
  liquidCurrencyCode,
  onConfirm,
  onCancel,
  loading,
}: StrategyChangeConfirmProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const liquidCode =
    (liquidCurrencyCode as import("@/lib/constants/currencies").CurrencyCode | null | undefined) ??
    undefined;
  const fmtMoney = (val: number) => {
    const anchor = liquidCode ? toInternalFrom(val, liquidCode) : val;
    return formatAmount(anchor, liquidCode);
  };
  const [marketData, setMarketData] = useState<Record<string, CommodityMarket>>({});

  useEffect(() => {
    let cancelled = false;
    fetchJson<{
      commodities?: {
        commodity: string;
        globalSupply: number;
        globalDemand: number;
      }[];
    }>("/api/commodities", { feature: "commodities-market" })
      .then((data) => {
        if (cancelled) return;
        const map: Record<string, CommodityMarket> = {};
        for (const c of data.commodities ?? []) {
          map[c.commodity] = {
            globalSupply: c.globalSupply,
            globalDemand: c.globalDemand,
          };
        }
        setMarketData(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { preset } = useWorldFlags();
  // A vehicle plant is stored as manufacturing and an entertainment lane as
  // media; both run the folded type's recipes, so resolve the operating type
  // before looking strategies up or the target is never found.
  const operatingType = getOperatingSectorType(sectorType, industryModel, mediaDiscriminator);
  const strategies = getSectorStrategies(
    operatingType,
    mediaOperatingModelsEnabled === true,
    null,
    preset
  );
  if (!strategies) return null;

  const current = getStrategyForOperatingModel(
    sectorType,
    currentStrategyId,
    industryModel,
    mediaDiscriminator,
    preset
  );
  const target = strategies.find((s) => s.id === targetStrategyId) as SectorStrategy | undefined;
  if (!current || !target) return null;

  const retoolCost = dailyRevenue * STRATEGY_RETOOL_COST_FRACTION;
  const hasMarketData = Object.keys(marketData).length > 0;

  // Estimate commodity margin impact
  const currentMargin = hasMarketData
    ? estimateCommodityMargin(current.supply, current.demand, marketData)
    : null;
  const targetMargin = hasMarketData
    ? estimateCommodityMargin(target.supply, target.demand, marketData)
    : null;
  const marginDelta =
    currentMargin != null && targetMargin != null ? targetMargin - currentMargin : null;

  // Build commodity change rows — group by commodity, showing what changes
  const allCommodities = new Map<
    CommodityType,
    { oldSupply: number; newSupply: number; oldDemand: number; newDemand: number }
  >();

  for (const key of [
    ...Object.keys(current.supply),
    ...Object.keys(target.supply),
    ...Object.keys(current.demand),
    ...Object.keys(target.demand),
  ] as CommodityType[]) {
    if (!allCommodities.has(key)) {
      allCommodities.set(key, {
        oldSupply: current.supply[key] ?? 0,
        newSupply: target.supply[key] ?? 0,
        oldDemand: current.demand[key] ?? 0,
        newDemand: target.demand[key] ?? 0,
      });
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-3 shadow-lg space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Switch to {target.name}?</span>
        <span className="text-xs text-error font-medium">
          Retooling cost {fmtMoney(retoolCost)}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-muted">{target.description}</p>

      {/* Commodity changes table */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-xs font-semibold text-foreground border-b border-card-border">
            <th className="text-left py-1 font-semibold">Commodity</th>
            <th
              className="text-right py-1 pr-1.5 font-semibold"
              title="Units produced per 100 units of output, old then new"
            >
              Makes
            </th>
            <th
              className="text-right py-1 pr-1.5 font-semibold"
              title="Units used per 100 units of output, old then new"
            >
              Needs
            </th>
            <th
              className="text-right py-1 font-semibold"
              title="World supply against world demand right now"
            >
              World market
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from(allCommodities.entries()).map(
            ([commodity, { oldSupply, newSupply, oldDemand, newDemand }]) => {
              const supplyChanged = oldSupply !== newSupply;
              const demandChanged = oldDemand !== newDemand;
              const m = marketData[commodity];
              const status = m ? getMarketStatus(m.globalSupply, m.globalDemand) : undefined;

              return (
                <tr key={commodity} className="text-xs border-b border-card-border/30">
                  <td className="py-0.5 pr-1">
                    <span className="flex items-center gap-1">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-card-elevated text-[8px] font-bold text-muted">
                        {COMMODITY_ICONS[commodity]}
                      </span>
                      <span
                        className="text-muted truncate max-w-[120px]"
                        title={COMMODITY_LABELS[commodity]}
                      >
                        {COMMODITY_LABELS[commodity]}
                      </span>
                    </span>
                  </td>
                  <td className="py-0.5 tabular-nums text-right pr-1.5">
                    {supplyChanged ? (
                      <span>
                        <span className="text-muted">{per100(oldSupply)}</span>
                        <span className="text-muted/50 mx-0.5">→</span>
                        <span
                          className={
                            newSupply > oldSupply
                              ? "text-blue-400 font-medium"
                              : newSupply === 0
                                ? "text-error/70"
                                : "text-blue-400/60"
                          }
                        >
                          {per100(newSupply)}
                        </span>
                      </span>
                    ) : oldSupply > 0 ? (
                      <span className="text-muted/50">{per100(oldSupply)}</span>
                    ) : (
                      <span className="text-muted/30">0</span>
                    )}
                  </td>
                  <td className="py-0.5 tabular-nums text-right pr-1.5">
                    {demandChanged ? (
                      <span>
                        <span className="text-muted">{per100(oldDemand)}</span>
                        <span className="text-muted/50 mx-0.5">→</span>
                        <span
                          className={
                            newDemand > oldDemand
                              ? "text-amber-400 font-medium"
                              : newDemand === 0
                                ? "text-success/70"
                                : "text-amber-400/60"
                          }
                        >
                          {per100(newDemand)}
                        </span>
                      </span>
                    ) : oldDemand > 0 ? (
                      <span className="text-muted/50">{per100(oldDemand)}</span>
                    ) : (
                      <span className="text-muted/30">0</span>
                    )}
                  </td>
                  <td className="py-0.5 text-right">
                    {status && (
                      <span className={`text-xs ${STATUS_STYLE[status]}`}>
                        {STATUS_LABEL[status]}
                      </span>
                    )}
                  </td>
                </tr>
              );
            }
          )}
        </tbody>
      </table>

      {/* Margin estimate */}
      {marginDelta != null && (
        <div className="flex items-center justify-between text-xs bg-background rounded px-2 py-1">
          <span
            className="text-muted"
            title="Rough estimate from current world prices. Percentage points of margin."
          >
            Estimated margin from commodity prices
          </span>
          <span className="tabular-nums">
            <span className="text-muted">
              {currentMargin! >= 0 ? "+" : ""}
              {currentMargin!.toFixed(1)}%
            </span>
            <span className="text-muted/50 mx-1">→</span>
            <span
              className={
                targetMargin! > currentMargin!
                  ? "text-success font-medium"
                  : targetMargin! < currentMargin!
                    ? "text-error font-medium"
                    : "text-muted"
              }
            >
              {targetMargin! >= 0 ? "+" : ""}
              {targetMargin!.toFixed(1)}%
            </span>
            <span
              className={`ml-1.5 ${marginDelta > 0 ? "text-success" : marginDelta < 0 ? "text-error" : "text-muted"}`}
            >
              ({marginDelta > 0 ? "+" : ""}
              {marginDelta.toFixed(1)})
            </span>
          </span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-xs text-muted">
          Phases in over {STRATEGY_TRANSITION_TURNS} turns, costs{" "}
          {Math.abs(STRATEGY_TRANSITION_MARGIN_PENALTY)} points of margin meanwhile, and locks
          further changes for {STRATEGY_COOLDOWN_TURNS} turns.
        </span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded border border-card-border px-2.5 py-1 text-xs text-muted hover:bg-card-elevated disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Switching" : "Switch strategy"}
          </button>
        </span>
      </div>
    </div>
  );
}
