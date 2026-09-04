"use client";

import { formatFundsCompact } from "@/lib/utils/formatters";
import {
  deriveMinisterFlags,
  deriveMinisterProjection,
  describeProjectionAssumptions,
  type MinisterFlagTone,
  type MinisterInputs,
} from "./ministerLens";

/**
 * Finance-Minister lens (ported from the design prototype `bbreakdowns.jsx`):
 * a confidential briefing banner, fiscal-health risk-flag cards, and a next-FY
 * projection. Rendered only when the seated finance minister opens the minister
 * lens (gated by the page).
 */

const FLAG_RING: Record<MinisterFlagTone, string> = {
  down: "border-error/30 bg-error/5",
  warning: "border-warning/30 bg-warning/5",
  up: "border-success/30 bg-success/5",
};
const FLAG_DOT: Record<MinisterFlagTone, string> = {
  down: "text-error",
  warning: "text-warning",
  up: "text-success",
};

function ProjTile({
  label,
  value,
  delta,
  sym,
  tone,
  invert,
  sub,
}: {
  label: string;
  value: string;
  delta?: number;
  sym: string;
  tone?: "up" | "down";
  invert?: boolean;
  sub?: string;
}) {
  const valueTone =
    tone === "up" ? "text-success" : tone === "down" ? "text-error" : "text-foreground";
  const deltaGood = delta != null && (invert ? -delta : delta) >= 0;
  return (
    <div className="rounded-lg border border-card-border bg-card-muted p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${valueTone}`}>{value}</div>
      {delta != null && (
        <div className={`text-[11px] tabular-nums ${deltaGood ? "text-success" : "text-error"}`}>
          {delta >= 0 ? "+" : "−"}
          {formatFundsCompact(Math.abs(delta), sym)} vs now
        </div>
      )}
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

interface MinisterCalloutsProps {
  inputs: MinisterInputs;
  /** Page subtitle (e.g. "China Central Government Finances") for the briefing. */
  subtitle: string;
  /** Current fiscal year; the projection is labeled FY+1. */
  fiscalYear: number;
}

export function MinisterCallouts({ inputs, subtitle, fiscalYear }: MinisterCalloutsProps) {
  const sym = inputs.sym;
  const flags = deriveMinisterFlags(inputs);
  const proj = deriveMinisterProjection(inputs);

  return (
    <div className="space-y-4">
      {/* Briefing banner */}
      <div className="rounded-xl border border-gold/25 bg-gold/[0.06] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-gold"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.3 5.2 16.7l.9-5.4L2.2 7.7l5.4-.8z" />
          </svg>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gold/80">
              Finance Minister briefing
            </div>
            <p className="mt-1 max-w-3xl text-body-sm leading-relaxed text-foreground/90">
              Confidential fiscal-health read for {subtitle}. Public viewers see the published
              accounts only; this lens adds risk flags and a next-fiscal-year projection.
            </p>
          </div>
        </div>
      </div>

      {/* Risk-flag cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {flags.map((f) => (
          <div key={f.title} className={`rounded-xl border p-3.5 ${FLAG_RING[f.tone]}`}>
            <div className="flex items-start gap-2">
              <svg
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${FLAG_DOT[f.tone]}`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
              >
                <circle cx="10" cy="10" r="7" />
              </svg>
              <span className="text-body-sm font-semibold leading-tight text-foreground">
                {f.title}
              </span>
            </div>
            <p className="mt-1.5 text-body-xs leading-snug text-muted">{f.detail}</p>
          </div>
        ))}
      </div>

      {/* Next-FY projection */}
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">FY{fiscalYear + 1} projection</div>
          <div className="text-body-xs text-muted">
            Illustrative — revenue tracks GDP, spending tracks inflation + demographics
          </div>
          <div className="mt-0.5 text-body-xs text-muted">
            {describeProjectionAssumptions(inputs)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ProjTile
            label="Proj. revenue"
            value={formatFundsCompact(proj.projRevenue, sym)}
            delta={proj.projRevenue - inputs.revenueTotal}
            sym={sym}
          />
          <ProjTile
            label="Proj. spending"
            value={formatFundsCompact(proj.projSpending, sym)}
            delta={proj.projSpending - inputs.spendingTotal}
            sym={sym}
            invert
          />
          <ProjTile
            label={proj.projSurplus >= 0 ? "Proj. surplus" : "Proj. deficit"}
            value={formatFundsCompact(Math.abs(proj.projSurplus), sym)}
            sym={sym}
            tone={proj.projSurplus >= 0 ? "up" : "down"}
          />
          <ProjTile
            label="Proj. debt-to-GDP"
            value={`${(proj.projDebtToGdp * 100).toFixed(0)}%`}
            sym={sym}
            tone={proj.projDebtToGdp > proj.currentDebtToGdp ? "down" : "up"}
            sub={
              proj.projDebtToGdp > proj.currentDebtToGdp && inputs.gdpGrowth < 0
                ? `↑ from ${(proj.currentDebtToGdp * 100).toFixed(0)}% · shrinking GDP lifts the ratio too, not just new borrowing`
                : `${proj.projDebtToGdp > proj.currentDebtToGdp ? "↑" : "↓"} from ${(proj.currentDebtToGdp * 100).toFixed(0)}%`
            }
          />
        </div>
      </div>
    </div>
  );
}
