import type { InflationBreakdown } from "./centralBankTypes";

export function InflationBreakdownTooltip({
  breakdown,
  total,
  effectiveRate,
}: {
  breakdown: InflationBreakdown;
  total: number;
  effectiveRate: number;
}) {
  const rows: { label: string; value: number; note?: string }[] = [
    { label: "Base target", value: breakdown.base },
    { label: "Unemployment", value: breakdown.unemployment, note: "vs 5% NAIRU" },
    { label: "GDP growth", value: breakdown.gdp, note: "vs 2% trend" },
    {
      label: "Monetary policy",
      value: breakdown.monetary,
      note: `eff. rate ${effectiveRate.toFixed(2)}%`,
    },
    { label: "Fiscal stance", value: breakdown.fiscal, note: "deficit/GDP" },
    { label: "Tariffs", value: breakdown.tariff, note: "vs 3% baseline" },
    { label: "Wages", value: breakdown.wage, note: "vs 2.5% baseline" },
    { label: "Commodities", value: breakdown.commodity },
    { label: "Forex (FX)", value: breakdown.forex },
    { label: "Savings flow", value: breakdown.savings },
    {
      label: "Money supply",
      value: breakdown.moneySupply ?? 0,
      note: "M2 growth vs real growth",
    },
    { label: "Monetary stance", value: breakdown.policy, note: "PBoC stance / orders" },
    { label: "Inertia", value: breakdown.inertia, note: "smoothing" },
  ].filter((r) => Math.abs(r.value) >= 0.005);

  return (
    <div className="space-y-1">
      <p className="mb-2 text-body-sm font-semibold text-foreground">Inflation drivers</p>
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-2">
          <span className="text-body-sm text-muted">
            {row.label}
            {row.note && <span className="text-muted/60"> ({row.note})</span>}
          </span>
          <span
            className={`shrink-0 text-body-sm font-semibold tabular-nums ${
              row.value > 0.005 ? "text-error" : row.value < -0.005 ? "text-success" : "text-muted"
            }`}
          >
            {row.value >= 0 ? "+" : ""}
            {row.value.toFixed(2)} pp
          </span>
        </div>
      ))}
      <div className="border-t border-card-border mt-1.5 pt-1.5 flex items-baseline justify-between">
        <span className="text-body-sm font-semibold text-foreground">Total</span>
        <span className="text-body-sm font-bold tabular-nums text-foreground">
          {total.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
