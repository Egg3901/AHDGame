"use client";

import { useState } from "react";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { InfoTooltip } from "@/components/InfoTooltip";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FundTransaction {
  id: string;
  kind: string;
  turn: number | null;
  amountAnchor: number;
  navAnchor: number | null;
  units: number | null;
  shares: number | null;
  corporationId: string | null;
  note: string | null;
  createdAt: string;
}

export interface FundFinancialsData {
  fundId: string;
  anchorCurrencyCode: string;
  transactions: FundTransaction[];
}

export interface FundBalanceSheetData {
  cashAnchor: number;
  holdingsValueAnchor: number;
  bondPrincipalAnchor: number;
  totalBackingAnchor: number;
  quotedLiabilityAnchor: number;
  backingRatio: number | null;
  unitSupply: number;
  quotedNav: number;
}

interface FundFinancialsTabProps {
  financials: FundFinancialsData | null;
  balanceSheet: FundBalanceSheetData | null;
  formatAmount: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const INCOME_KINDS = new Set(["dividend_pass_through", "dividend_reinvest", "bond_allocation"]);

const EXPENSE_KINDS = new Set(["public_float_buy", "redemption", "redemption_queued"]);

function classifyKind(kind: string): "income" | "expense" | "neutral" {
  if (INCOME_KINDS.has(kind)) return "income";
  if (EXPENSE_KINDS.has(kind)) return "expense";
  return "neutral";
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    subscription: "Unit subscription",
    redemption: "Unit redemption",
    redemption_queued: "Redemption queued",
    public_float_buy: "Stock purchase",
    public_float_sell: "Stock sale",
    dividend_reinvest: "Dividend reinvested",
    dividend_pass_through: "Dividend pass-through",
    bond_allocation: "Bond allocation",
  };
  return map[kind] ?? kind.replace(/_/g, " ");
}

function FinRow({
  label,
  value,
  valueClass = "text-foreground",
  bold = false,
  indent = false,
  tooltip,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
  indent?: boolean;
  tooltip?: string;
}) {
  const content = (
    <div className={`flex items-center justify-between py-1 ${indent ? "pl-4" : ""}`}>
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm tabular-nums ${bold ? "font-semibold" : ""} ${valueClass}`}>
        {value}
      </span>
    </div>
  );
  if (tooltip) {
    return (
      <InfoTooltip trigger={<div className="cursor-help">{content}</div>} width={260}>
        {tooltip}
      </InfoTooltip>
    );
  }
  return content;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FundFinancialsTab({
  financials,
  balanceSheet,
  formatAmount,
  ccy,
}: FundFinancialsTabProps) {
  const [view, setView] = useState<"income_statement" | "balance_sheet">("income_statement");

  // ── Income Statement ──────────────────────────────────────────────────────
  const incomeStatement = (() => {
    if (!financials) return null;

    let grossIncome = 0;
    let grossExpense = 0;
    const byKind = new Map<string, { income: number; expense: number; count: number }>();

    for (const tx of financials.transactions) {
      const cls = classifyKind(tx.kind);
      if (cls === "neutral") continue;
      const amt = Math.abs(tx.amountAnchor);
      const existing = byKind.get(tx.kind) ?? { income: 0, expense: 0, count: 0 };
      if (cls === "income") {
        grossIncome += amt;
        existing.income += amt;
      } else {
        grossExpense += amt;
        existing.expense += amt;
      }
      existing.count += 1;
      byKind.set(tx.kind, existing);
    }

    const netIncome = grossIncome - grossExpense;

    return {
      grossIncome,
      grossExpense,
      netIncome,
      byKind,
    };
  })();

  // ── Balance Sheet ─────────────────────────────────────────────────────────
  const bs = balanceSheet;

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center gap-1 rounded-lg bg-card-elevated p-1 w-fit border border-card-border">
        {(
          [
            { key: "income_statement" as const, label: "Income Statement" },
            { key: "balance_sheet" as const, label: "Balance Sheet" },
          ] as const
        ).map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === v.key
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "income_statement" && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="border-b border-card-border bg-background/60 px-6 py-4">
            <h2 className="text-lg font-bold text-foreground">Income Statement</h2>
            <p className="text-xs text-muted mt-0.5">
              Fund-wide totals across all holders — based on the last 200 transactions
            </p>
          </div>

          <div className="px-6 py-4 space-y-1">
            {incomeStatement ? (
              <>
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-1 pb-2">
                  Revenue
                </div>
                {Array.from(incomeStatement.byKind.entries())
                  .filter(([, vals]) => vals.income > 0)
                  .map(([kind, vals]) => (
                    <FinRow
                      key={kind}
                      label={kindLabel(kind)}
                      value={formatAmount(vals.income, ccy)}
                      valueClass="text-foreground"
                      indent
                      tooltip={`${vals.count} transaction${vals.count === 1 ? "" : "s"}`}
                    />
                  ))}
                {incomeStatement.grossIncome === 0 && (
                  <p className="text-sm text-muted pl-4">No recorded income.</p>
                )}

                <div className="border-t border-card-border mt-3" />
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
                  Expenses
                </div>
                {Array.from(incomeStatement.byKind.entries())
                  .filter(([, vals]) => vals.expense > 0)
                  .map(([kind, vals]) => (
                    <FinRow
                      key={kind}
                      label={kindLabel(kind)}
                      value={`(${formatAmount(vals.expense, ccy)})`}
                      valueClass="text-error"
                      indent
                      tooltip={`${vals.count} transaction${vals.count === 1 ? "" : "s"}`}
                    />
                  ))}
                {incomeStatement.grossExpense === 0 && (
                  <p className="text-sm text-muted pl-4">No recorded expenses.</p>
                )}

                <div className="border-t-2 border-foreground/20 mt-3 pt-2">
                  <FinRow
                    label="Net Income"
                    value={formatAmount(incomeStatement.netIncome, ccy)}
                    valueClass={incomeStatement.netIncome >= 0 ? "text-success" : "text-error"}
                    bold
                    tooltip="Total income minus total expenses from recorded transactions."
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No transaction data available.</p>
            )}
          </div>
        </div>
      )}

      {view === "balance_sheet" && bs && (
        <div className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="border-b border-card-border bg-background/60 px-6 py-4">
            <h2 className="text-lg font-bold text-foreground">Balance Sheet</h2>
            <p className="text-xs text-muted mt-0.5">Assets = Liabilities + Equity</p>
          </div>

          <div className="px-6 py-4 space-y-1">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-1 pb-2">
              Assets
            </div>
            <FinRow
              label="Cash & equivalents"
              value={formatAmount(bs.cashAnchor, ccy)}
              tooltip="Liquid cash held by the fund, including bond-deployment reserves."
            />
            <FinRow
              label="Equity holdings"
              value={formatAmount(bs.holdingsValueAnchor, ccy)}
              tooltip="Mark-to-market value of all stock positions held by the fund."
            />
            <FinRow
              label="Bond reserve principal"
              value={formatAmount(bs.bondPrincipalAnchor, ccy)}
              tooltip="Sovereign bond principal held in the fund reserve bucket."
            />
            <div className="border-t border-card-border mt-2 pt-2">
              <FinRow label="Total Assets" value={formatAmount(bs.totalBackingAnchor, ccy)} bold />
            </div>

            <div className="border-t border-card-border mt-3" />
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
              Liabilities
            </div>
            <FinRow
              label="Outstanding units (liability)"
              value={formatAmount(bs.quotedLiabilityAnchor, ccy)}
              tooltip="NAV × units outstanding. Represents the amount the fund owes to unit holders."
            />

            <div className="border-t border-card-border mt-3" />
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider pt-3 pb-2">
              Equity / Coverage
            </div>
            <FinRow
              label="Backing surplus"
              value={formatAmount(bs.totalBackingAnchor - bs.quotedLiabilityAnchor, ccy)}
              valueClass={
                bs.totalBackingAnchor >= bs.quotedLiabilityAnchor ? "text-success" : "text-error"
              }
              tooltip="Total assets minus outstanding unit liability."
            />
            <FinRow
              label="Backing ratio"
              value={bs.backingRatio != null ? `${(bs.backingRatio * 100).toFixed(1)}%` : "—"}
              valueClass={
                (bs.backingRatio ?? 1) >= 1
                  ? "text-success"
                  : (bs.backingRatio ?? 0) >= 0.5
                    ? "text-warning"
                    : "text-error"
              }
              tooltip="Assets divided by unit liability. <50% triggers auto-pause."
            />

            <div className="border-t-2 border-foreground/20 mt-3 pt-2">
              <FinRow
                label="Net Position"
                value={formatAmount(bs.totalBackingAnchor - bs.quotedLiabilityAnchor, ccy)}
                valueClass={
                  bs.totalBackingAnchor >= bs.quotedLiabilityAnchor ? "text-success" : "text-error"
                }
                bold
                tooltip="The fund's net equity position."
              />
            </div>
          </div>

          <div className="border-t border-card-border bg-background/40 px-6 py-4">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
              Key Metrics
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <div className="text-[11px] text-muted mb-0.5">NAV / unit</div>
                <div className="text-sm font-semibold text-foreground tabular-nums">
                  {formatAmount(bs.quotedNav, ccy)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted mb-0.5">Units outstanding</div>
                <div className="text-sm font-semibold text-foreground tabular-nums">
                  {bs.unitSupply.toLocaleString("en-US")}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted mb-0.5">Total backing</div>
                <div className="text-sm font-semibold text-foreground tabular-nums">
                  {formatAmount(bs.totalBackingAnchor, ccy)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted mb-0.5">Backing ratio</div>
                <div className="text-sm font-semibold tabular-nums">
                  {bs.backingRatio != null ? `${(bs.backingRatio * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "balance_sheet" && !bs && (
        <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted">
          No balance sheet data available.
        </div>
      )}
    </div>
  );
}
