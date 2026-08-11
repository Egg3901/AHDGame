"use client";

import type { Summary } from "../useCorporationsAdminState";
import { fmt } from "./format";

export function CorpSummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[
        { label: "Total Corps", value: String(summary.total) },
        {
          label: "Active / Suspended",
          value: `${summary.active} / ${summary.suspended}`,
          highlight: summary.suspended > 0,
        },
        {
          label: "CEO Vacancies",
          value: String(summary.ceoVacancies),
          highlight: summary.ceoVacancies > 0,
        },
        { label: "Total Liquid Capital", value: fmt(summary.totalLiquidCapital) },
      ].map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-card-border bg-card p-4 space-y-1"
        >
          <p className="text-xs text-muted uppercase tracking-wider">{card.label}</p>
          <p
            className={`text-xl font-semibold ${card.highlight ? "text-error" : "text-foreground"}`}
          >
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
