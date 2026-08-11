"use client";

import { Badge, Tooltip } from "@/components/ui";
import {
  PLANNED_ECONOMY_METRIC_TOOLTIPS,
  presentPlannedEconomy,
  type PlannedEconomyFactors,
} from "@/lib/economy/presentPlannedEconomy";

interface PlannedEconomyPanelProps {
  countryId: string;
  currentYear: number | null | undefined;
  /** GameConfig.commandEconomyEnabled — false/undefined hides unless factors exist. */
  commandEconomyEnabled?: boolean | null;
  factors: PlannedEconomyFactors | null | undefined;
}

function fmtIndex(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(0);
}

function fmtPremium(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `+${(v * 100).toFixed(0)}%`;
}

function fmtShare(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

/** 0–100 index bar; muted when value missing. */
function IndexBar({ value }: { value: number | null }) {
  const pct = value != null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const empty = value == null || !Number.isFinite(value);
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-card-muted">
      <div
        className={`h-full rounded-full ${empty ? "bg-muted/30" : "bg-warning/70"}`}
        style={{ width: `${empty ? 0 : pct}%` }}
      />
    </div>
  );
}

/**
 * Planned-economy macro readouts (monetary overhang, shortage, black-market
 * premium, second-economy share). Hidden for market economies / flag-off worlds
 * so those pages stay visually unchanged.
 */
export function PlannedEconomyPanel({
  countryId,
  currentYear,
  commandEconomyEnabled,
  factors,
}: PlannedEconomyPanelProps) {
  const view = presentPlannedEconomy(countryId, currentYear, commandEconomyEnabled, factors);
  if (!view) return null;

  const metrics: Array<{
    key: keyof typeof PLANNED_ECONOMY_METRIC_TOOLTIPS;
    label: string;
    value: string;
    bar: number | null;
  }> = [
    {
      key: "monetaryOverhang",
      label: "Monetary overhang",
      value: fmtIndex(view.monetaryOverhang),
      bar: view.monetaryOverhang,
    },
    {
      key: "shortageIndex",
      label: "Shortage index",
      value: fmtIndex(view.shortageIndex),
      bar: view.shortageIndex,
    },
    {
      key: "blackMarketPremium",
      label: "Black-market premium",
      value: fmtPremium(view.blackMarketPremium),
      bar:
        view.blackMarketPremium != null
          ? Math.min(100, view.blackMarketPremium * 50) // 2.0 premium → full bar
          : null,
    },
    {
      key: "secondEconomyShare",
      label: "Second-economy share",
      value: fmtShare(view.secondEconomyShare),
      bar: view.secondEconomyShare != null ? view.secondEconomyShare * 100 : null,
    },
  ];

  return (
    <div className="rounded-xl border border-card-border bg-card px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-foreground">Planned Economy</h3>
            <Badge color={view.regime === "command" ? "warning" : "info"} variant="subtle">
              {view.regimeLabel}
            </Badge>
            <Tooltip content={view.regimeExplainer} label="About this economic regime" />
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted">{view.regimeExplainer}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.key}>
            <div className="flex items-center text-[10px] font-bold uppercase tracking-wide text-muted">
              {m.label}
              <Tooltip
                content={PLANNED_ECONOMY_METRIC_TOOLTIPS[m.key]}
                label={`About ${m.label}`}
              />
            </div>
            <div className="mt-0.5 text-[15px] font-bold tabular-nums text-foreground">
              {m.value}
            </div>
            <IndexBar value={m.bar} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PlannedEconomyPanel;
