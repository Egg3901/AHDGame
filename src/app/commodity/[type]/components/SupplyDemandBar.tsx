"use client";

import { formatUnits } from "../lib/helpers";
import { postImportBalance } from "@/lib/trade/postImportGap";

interface SupplyDemandBarProps {
  supply: number;
  demand: number;
  unit: string;
  marketLabel?: string;
  /** Imports reaching this market; null/undefined when unknown (global view). */
  imports?: number | null;
}

export default function SupplyDemandBar({
  supply,
  demand,
  unit,
  marketLabel,
  imports,
}: SupplyDemandBarProps) {
  const total = supply + demand;
  if (total <= 0) return null;

  const supplyPct = (supply / total) * 100;
  const demandPct = 100 - supplyPct;

  // With imports known, the balance reads production plus imports against demand,
  // so a gap that imports close is not called a shortage.
  const importsKnown = typeof imports === "number";
  const effectiveSupply = importsKnown
    ? supply + postImportBalance(supply, demand, imports).imports
    : supply;

  // Raw D/S is shown for diagnosis; price and margin math softens pressure above 3x.
  const rawDsRatio = effectiveSupply > 0 ? demand / effectiveSupply : demand > 0 ? Infinity : 1;
  const formattedRawDsRatio = Number.isFinite(rawDsRatio)
    ? `${rawDsRatio.toFixed(2)}x`
    : "no supply";

  const balanceText =
    rawDsRatio === 0
      ? "No demand"
      : rawDsRatio < 0.95
        ? `${((1 / rawDsRatio - 1) * 100).toFixed(0)}% oversupplied`
        : rawDsRatio > 1.05
          ? Number.isFinite(rawDsRatio)
            ? `${((rawDsRatio - 1) * 100).toFixed(0)}% undersupplied`
            : "No supply"
          : "Balanced";
  const balanceSuffix = importsKnown && rawDsRatio !== 0 ? " after imports" : "";

  const balanceColor =
    rawDsRatio < 0.95 ? "text-success" : rawDsRatio > 1.05 ? "text-error" : "text-muted";

  return (
    <div className="rounded-xl border border-card-border bg-card px-5 py-4 mb-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-body-sm font-medium text-muted">Supply / Demand balance</span>
          {marketLabel && <div className="text-[10px] text-muted mt-0.5">{marketLabel}</div>}
        </div>
        <span className={`text-xs font-semibold ${balanceColor}`}>
          {balanceText}
          {balanceSuffix}
        </span>
      </div>
      <div className="relative h-4 w-full rounded-full overflow-hidden bg-card-elevated flex">
        <div
          className="h-full bg-success/70 transition-all duration-300"
          style={{ width: `${supplyPct}%` }}
          title={`Supply: ${formatUnits(supply, unit)}/day`}
        />
        <div
          className="h-full bg-error/70 transition-all duration-300"
          style={{ width: `${demandPct}%` }}
          title={`Demand: ${formatUnits(demand, unit)}/day`}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] font-medium">
        <span className="text-success">Supply {supplyPct.toFixed(0)}%</span>
        <span
          className="text-muted text-center"
          title="Raw demand/supply ratio. Prices and margin effects use softened effective pressure above 3x."
        >
          {importsKnown ? "D/S after imports" : "Raw D/S"} {formattedRawDsRatio}
        </span>
        <span className="text-error">Demand {demandPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}
