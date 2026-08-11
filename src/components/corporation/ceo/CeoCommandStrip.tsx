"use client";

import { InfoTooltip } from "@/components/InfoTooltip";
import { Meter } from "@/components/corporation/market/MarketPrimitives";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationDetail, Financials, SectorDetail } from "../CorporationPageTypes";

interface CeoCommandStripProps {
  corporation: CorporationDetail;
  financials: Financials;
  sectors: SectorDetail[];
  brandHex?: string;
  editMarketingBudget: string;
  editLogisticsBudget: string;
  editRdBudget: string;
  editCeoSalary: number;
  editDividendRate: number;
}

function KpiTile({
  label,
  children,
  tooltip,
  tone = "default",
  featured = false,
}: {
  label: string;
  children: React.ReactNode;
  tooltip?: React.ReactNode;
  tone?: "default" | "success" | "error" | "warning";
  featured?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "error"
        ? "text-error"
        : tone === "warning"
          ? "text-warning"
          : "text-foreground";

  const labelEl = tooltip ? (
    <InfoTooltip
      trigger={
        <span className="cursor-help border-b border-dotted border-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
      }
      width={260}
    >
      {tooltip}
    </InfoTooltip>
  ) : (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span>
  );

  return (
    <div
      className={`rounded-xl border px-4 py-3 overflow-hidden ${
        featured ? "border-primary/25 bg-card-elevated shadow-sm" : "border-card-border bg-card"
      }`}
      style={
        featured
          ? ({
              backgroundImage:
                "linear-gradient(135deg, color-mix(in srgb, var(--ceo-brand, var(--primary)) 10%, var(--card-elevated)) 0%, var(--card-elevated) 48%)",
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="mb-1.5">{labelEl}</div>
      <div className={`font-mono text-xl font-bold tabular-nums truncate ${toneClass}`}>
        {children}
      </div>
    </div>
  );
}

export function CeoCommandStrip({
  corporation,
  financials,
  sectors,
  brandHex,
  editMarketingBudget,
  editLogisticsBudget,
  editRdBudget,
  editCeoSalary,
  editDividendRate,
}: CeoCommandStripProps) {
  const { formatAmount, formatFull, toInternalFrom } = useCurrency();
  const liquidCode = (corporation.liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const toAnchor = (local: number) => (liquidCode ? toInternalFrom(local, liquidCode) : local);

  const fmt = (val: number) => formatAmount(toAnchor(val), liquidCode);
  const fmtFull = (val: number) =>
    liquidCode
      ? formatFull(toInternalFrom(val, liquidCode), liquidCode)
      : formatFull(val, liquidCode);

  const combinedOverhead =
    Math.max(0, Number(editMarketingBudget) || 0) +
    Math.max(0, Number(editLogisticsBudget) || 0) +
    Math.max(0, Number(editRdBudget) || 0) +
    editCeoSalary;
  const overheadPct =
    financials.totalRevenue > 0 ? (combinedOverhead / financials.totalRevenue) * 100 : 0;
  const overheadCapPct = 150;
  const isOverCap = financials.totalRevenue > 0 && combinedOverhead > financials.totalRevenue * 1.5;

  const stateCount = new Set(sectors.map((s) => s.stateId)).size;
  // Ground-truth realized income (what the engine booked last turn) over the
  // projection when available — the projection can't reproduce embargo/tariff/
  // clearing haircuts (ticket #935). Falls back to the projection for new corps.
  const netIncome = financials.realizedIncome ?? financials.income;
  const netTone = netIncome >= 0 ? "success" : "error";

  return (
    <div
      className="space-y-3"
      style={
        brandHex ? ({ ["--ceo-brand" as string]: brandHex } as React.CSSProperties) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <KpiTile
          label="Treasury"
          featured
          tooltip={
            <p className="text-muted">
              Liquid capital available for operations, bonds, and growth.
            </p>
          }
        >
          {fmtFull(corporation.liquidCapital)}
        </KpiTile>

        <KpiTile
          label="Net Income / day"
          tone={netTone}
          tooltip={
            <div className="space-y-1 text-muted">
              <p>Revenue minus operating costs, taxes, and interest.</p>
              <p className="text-[11px]">Before dividend distributions.</p>
            </div>
          }
        >
          {netIncome >= 0 ? "+" : ""}
          {fmt(netIncome)}
        </KpiTile>

        <KpiTile
          label="Gross Revenue / day"
          tooltip={<p className="text-muted">Total revenue from all owned sectors.</p>}
        >
          {fmt(financials.totalRevenue)}
        </KpiTile>

        <KpiTile
          label="Dividend"
          tooltip={
            <p className="text-muted">
              Payout rate set by the CEO. Effective rate may be higher if legal structure requires a
              minimum dividend.
            </p>
          }
        >
          {editDividendRate}%
        </KpiTile>

        <KpiTile
          label="Sectors"
          tooltip={
            <p className="text-muted">
              Active holdings across {stateCount} {stateCount === 1 ? "state" : "states"}.
            </p>
          }
        >
          {sectors.length}
          <span className="ml-1 text-sm font-normal text-muted">
            / {stateCount} {stateCount === 1 ? "state" : "states"}
          </span>
        </KpiTile>

        <div className="rounded-xl border border-card-border bg-card-elevated px-4 py-3 overflow-hidden">
          <InfoTooltip
            trigger={
              <span className="cursor-help border-b border-dotted border-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Overhead
              </span>
            }
            width={260}
          >
            <p className="text-muted">
              Combined marketing, logistics, R&amp;D, and CEO salary budgets as a share of daily
              revenue. Cannot exceed 150% when saving budgets.
            </p>
          </InfoTooltip>
          <div
            className={`font-mono text-xl font-bold tabular-nums ${isOverCap ? "text-error" : overheadPct > 120 ? "text-warning" : "text-foreground"}`}
          >
            {financials.totalRevenue > 0 ? `${overheadPct.toFixed(0)}%` : "—"}
          </div>
          {financials.totalRevenue > 0 && (
            <div className="mt-2">
              <Meter
                value={Math.min(overheadPct, overheadCapPct)}
                max={overheadCapPct}
                tone={isOverCap ? "warning" : overheadPct > 120 ? "warning" : "brand"}
              />
              <p className="mt-1 text-[10px] text-muted tabular-nums">
                {fmt(combinedOverhead)} / {fmt(financials.totalRevenue * 1.5)} cap
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
