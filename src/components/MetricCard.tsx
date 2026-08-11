"use client";

import Link from "next/link";
import { InfoTooltip } from "@/components/InfoTooltip";

interface MetricCardProps {
  name: string;
  value: number | null;
  nationalAverage?: number | null;
  formatPrefix?: string;
  formatSuffix?: string;
  decimals?: number;
  isHigherBetter: boolean;
  trend?: number;
  description?: string;
  /** Active per-turn change rate from policies (positive = increasing, negative = decreasing) */
  tickRate?: number;
  /** If provided, clicking the metric name/value navigates to this URL */
  href?: string;
}

export function MetricCard({
  name,
  value,
  nationalAverage,
  formatPrefix = "",
  formatSuffix = "",
  decimals = 1,
  isHigherBetter,
  trend,
  description,
  tickRate,
  href,
}: MetricCardProps) {
  const isNullValue = value === null || value === undefined;
  const safeValue = value ?? 0;

  const formatValue = (val: number) => {
    const formatted = val.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${formatPrefix}${formatted}${formatSuffix}`;
  };

  const hasNatAvg = nationalAverage !== undefined && nationalAverage !== null;
  const comparisonDiff = hasNatAvg ? safeValue - nationalAverage : 0;
  const comparisonPct =
    hasNatAvg && nationalAverage !== 0
      ? ((safeValue - nationalAverage) / nationalAverage) * 100
      : 0;

  const isPositiveComparison = isHigherBetter ? comparisonDiff > 0 : comparisonDiff < 0;
  const isNeutralComparison = Math.abs(comparisonPct) < 2;

  const getComparisonColor = () => {
    if (isNeutralComparison) return "text-muted";
    return isPositiveComparison ? "text-green-400" : "text-red-400";
  };

  const getTrendIndicator = () => {
    if (trend === undefined || trend === 0) return null;
    const isPositiveTrend = isHigherBetter ? trend > 0 : trend < 0;
    const color = isPositiveTrend ? "text-green-400" : "text-red-400";
    const arrow = trend > 0 ? "↑" : "↓";
    return (
      <span className={`text-xs ${color}`}>
        {arrow} {Math.abs(trend).toFixed(1)}%
      </span>
    );
  };

  const hasTickRate = tickRate !== undefined && Math.abs(tickRate) > 0.0001;
  const isTickGood = hasTickRate && (isHigherBetter ? tickRate! > 0 : tickRate! < 0);
  const tickColor = hasTickRate ? (isTickGood ? "text-green-400" : "text-red-400") : "";
  const tickArrow = (tickRate ?? 0) > 0 ? "↑" : "↓";
  const tickAbs = Math.abs(tickRate ?? 0);
  const tickDecimals = tickAbs < 0.1 ? 3 : tickAbs < 1 ? 2 : 1;
  const tickLabel = hasTickRate
    ? `${tickArrow} ${tickAbs.toFixed(tickDecimals)}${formatSuffix}/turn`
    : null;

  const getProgressWidth = () => {
    if (!hasNatAvg) return 50;
    const ratio = nationalAverage !== 0 ? safeValue / nationalAverage! : 1;
    return Math.min(100, Math.max(0, ratio * 50));
  };

  const tickTooltipText = hasTickRate
    ? `Active policy effect: ${tickLabel}. Over 48 turns (1 game year) this will ${tickRate! > 0 ? "increase" : "decrease"} by ~${(tickAbs * 48).toFixed(1)}${formatSuffix}.`
    : null;

  const cardContent = (
    <>
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground">{name}</h4>
          {description && <p className="mt-0.5 text-xs text-muted line-clamp-1">{description}</p>}
        </div>
        {getTrendIndicator()}
      </div>

      <div className="mb-2 flex items-baseline gap-2 flex-wrap">
        {isNullValue ? (
          <span className="text-2xl font-bold text-muted">N/A</span>
        ) : (
          <>
            <span className="text-2xl font-bold text-foreground">{formatValue(safeValue)}</span>
            {hasNatAvg && (
              <span className={`text-sm ${getComparisonColor()}`}>
                {comparisonDiff >= 0 ? "+" : ""}
                {comparisonPct.toFixed(1)}% vs avg
              </span>
            )}
          </>
        )}
        {!isNullValue && hasTickRate && tickTooltipText && (
          <InfoTooltip
            trigger={<span className={`text-xs font-medium ${tickColor}`}>{tickLabel}</span>}
            width={224}
          >
            <p className="text-[10px] text-muted leading-snug">{tickTooltipText}</p>
          </InfoTooltip>
        )}
      </div>

      {!isNullValue && hasNatAvg && (
        <div className="space-y-1">
          <div className="relative h-2 rounded-full bg-card overflow-hidden">
            <div className="absolute left-1/2 top-0 h-full w-0.5 bg-muted -translate-x-1/2 z-10" />
            <div
              className={`h-full rounded-full transition-all ${
                isPositiveComparison
                  ? "bg-green-500"
                  : isNeutralComparison
                    ? "bg-muted"
                    : "bg-red-500"
              }`}
              style={{ width: `${getProgressWidth()}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>0</span>
            <span>Nat&apos;l Avg: {formatValue(nationalAverage)}</span>
            <span>{formatValue(nationalAverage * 2)}</span>
          </div>
        </div>
      )}
    </>
  );

  const cardClass =
    "rounded-lg border border-card-border bg-background p-4 transition-colors" +
    (href ? " hover:border-primary/40 hover:bg-card cursor-pointer" : " hover:border-primary/20");

  if (href) {
    return (
      <Link href={href} className={`block ${cardClass}`}>
        {cardContent}
      </Link>
    );
  }

  return <div className={cardClass}>{cardContent}</div>;
}

export default MetricCard;
