"use client";

// MoneyPanel — lifetime money totals (in / out / net), the embedded
// MoneyFlowGraph, and the recent financialTxLog rows. The totals are
// anchor-currency sums straight from the dossier aggregation; the graph and
// the table below let the investigator go from "net looks wrong" to "there's
// the counterparty" without leaving the page.

import { useMemo } from "react";
import { formatAmount, formatRelative } from "@/components/admin/forensics/types";
import { MoneyFlowGraph } from "./MoneyFlowGraph";
import {
  formatCompactAmount,
  formatDateTime,
  OVERLINE_CLS,
  PANEL_CLS,
  type DossierFinancialRow,
  type DossierMoneyTotals,
} from "./dossierTypes";

interface MoneyPanelProps {
  userId: string;
  totals: DossierMoneyTotals;
  recent: DossierFinancialRow[];
}

export function MoneyPanel({ userId, totals, recent }: MoneyPanelProps) {
  // The user's own character ids, harvested from the financial rows — the
  // graph uses them to pin "this account" at the hub.
  const centerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of recent) {
      if (row.subjectType === "character" && row.subjectId) ids.add(row.subjectId);
    }
    return [...ids];
  }, [recent]);

  return (
    <section className={PANEL_CLS} aria-label="Money">
      <h3 className={`mb-3 ${OVERLINE_CLS}`}>Money</h3>

      {/* Totals — three tiles, net carries the verdict color. */}
      <div className="grid grid-cols-3 gap-2.5">
        <TotalTile label="Flowed in" value={totals.creditsIn} toneClass="text-green-400" sign="+" />
        <TotalTile label="Flowed out" value={totals.debitsOut} toneClass="text-red-400" sign="-" />
        <TotalTile
          label="Net"
          value={Math.abs(totals.net)}
          toneClass={totals.net >= 0 ? "text-green-400" : "text-red-400"}
          sign={totals.net >= 0 ? "+" : "-"}
        />
      </div>

      {/* The flow graph. */}
      <div className="mt-4">
        <div className={`mb-2 ${OVERLINE_CLS}`}>Money-flow graph</div>
        <MoneyFlowGraph userId={userId} centerIds={centerIds} />
      </div>

      {/* Recent rows. */}
      <div className="mt-4">
        <div className={`mb-1.5 ${OVERLINE_CLS}`}>Recent transactions ({recent.length})</div>
        {recent.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">No transactions on record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="border-b border-card-border/70 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <th className="py-1.5 pr-3 font-semibold">Type</th>
                  <th className="py-1.5 pr-3 font-semibold">Subject</th>
                  <th className="py-1.5 pr-3 font-semibold">Counterparty</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Turn</th>
                  <th className="py-1.5 text-right font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {recent.map((row) => (
                  <tr key={row.id} className={row.flagged ? "bg-red-500/[0.04]" : undefined}>
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-[10px] tracking-tight text-foreground/80">
                        {row.type}
                      </span>
                      {row.flagged && (
                        <span
                          aria-label="Flagged transaction"
                          title="Flagged by anomaly detection"
                          className="ml-1.5 text-red-400"
                        >
                          ⚑
                        </span>
                      )}
                    </td>
                    <td className="max-w-[140px] truncate py-1.5 pr-3" title={row.subjectName}>
                      {row.subjectName}
                    </td>
                    <td
                      className="max-w-[140px] truncate py-1.5 pr-3 text-muted"
                      title={row.counterpartyName}
                    >
                      {row.counterpartyName ?? "—"}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right font-semibold tabular-nums ${
                        row.amount >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                      title={formatAmount(row.amount, row.currencyCode)}
                    >
                      {formatCompactAmount(row.amount, row.currencyCode, true)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{row.turn}</td>
                    <td
                      className="py-1.5 text-right tabular-nums text-muted"
                      title={formatDateTime(row.createdAt)}
                    >
                      {formatRelative(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function TotalTile({
  label,
  value,
  toneClass,
  sign,
}: {
  label: string;
  value: number;
  toneClass: string;
  sign: "+" | "-";
}) {
  return (
    <div className="rounded-lg border border-card-border/70 bg-card-elevated/40 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-bold tabular-nums tracking-tight ${toneClass}`}
        title={`${sign}${value.toLocaleString("en-US")} (anchor currency)`}
      >
        {sign}
        {formatCompactAmount(value)}
      </div>
    </div>
  );
}
