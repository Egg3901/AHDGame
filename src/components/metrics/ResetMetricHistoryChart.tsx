import { currencySymbolSep } from "@/lib/currency/symbolSep";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import type { ResetMetricCountry, ResetMetricRow } from "./ResetMetricBoard";

export type ResetMetricDetailResponse = Readonly<{
  history: Array<{ turn: number; value: number }>;
  nationalValue: number;
  regions: Array<{ regionId: string; name: string; value: number }>;
}>;

function historyValueLabel(
  metric: ResetMetricRow,
  countryId: ResetMetricCountry,
  value: number
): string {
  if (metric.id === "02") {
    const symbol = getCurrencyPrefix(countryId);
    const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
    return `${symbol}${currencySymbolSep(symbol)}${formatted}`;
  }
  const precision = Math.abs(value) < 10 ? 2 : 1;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: precision,
  }).format(value);
  return `${formatted}${metric.unit.startsWith("%") ? "" : " "}${metric.unit}`;
}

export function ResetMetricHistoryChart({
  countryId,
  metric,
  history,
}: {
  countryId: ResetMetricCountry;
  metric: ResetMetricRow;
  history: Array<{ turn: number; value: number }>;
}) {
  if (history.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-card-border bg-card-muted text-body-sm italic text-muted">
        Series begins this campaign. More history will appear as turns advance.
      </div>
    );
  }
  const width = 720;
  const height = 220;
  const pad = 28;
  const values = history.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const flatPadding = high === low ? Math.max(Math.abs(high) * 0.02, 1) : 0;
  const chartLow = low - flatPadding / 2;
  const range = Math.max(high - low, flatPadding);
  const points = history
    .map((point, index) => {
      const x = pad + (index / (history.length - 1)) * (width - pad * 2);
      const y = height - pad - ((point.value - chartLow) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = history[0]!;
  const last = history.at(-1)!;
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        role="img"
        aria-label={`${metric.name} history`}
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          className="stroke-card-border"
        />
        <polyline
          points={points}
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between gap-4 text-body-xs text-muted">
        <span>
          Turn {first.turn}: {historyValueLabel(metric, countryId, first.value)}
        </span>
        <span>
          Turn {last.turn}: {historyValueLabel(metric, countryId, last.value)}
        </span>
      </div>
    </div>
  );
}
