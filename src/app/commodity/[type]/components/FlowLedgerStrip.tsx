"use client";

import { formatUnits } from "../lib/helpers";
import type { CommodityDetail } from "../types";

/**
 * Flow-ledger summary (marketSystemMode >= "ledger", audit t806 Fix 3/D0):
 * what this market actually moved last turn — cleared volume, demand that
 * found no producer, and output that found no buyer. Hidden entirely when the
 * ledger is off (`flows` absent).
 */
export default function FlowLedgerStrip({
  flows,
  unit,
}: {
  flows: NonNullable<CommodityDetail["flows"]>;
  unit: string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card px-5 py-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted uppercase tracking-wider">
          Market Flows
        </span>
        <span className="text-[10px] text-muted tabular-nums">turn {flows.turn}</span>
      </div>
      <div
        className={`grid gap-3 text-center ${
          flows.stockUnits != null ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-3"
        }`}
      >
        <div title="Volume that transacted: the smaller of supply and demand. In a balanced market this equals both.">
          <div className="text-sm font-bold tabular-nums text-foreground">
            {formatUnits(flows.clearedUnits, unit)}
          </div>
          <div className="text-[10px] text-muted mt-0.5">Cleared</div>
        </div>
        <div title="Demand that found no producer this turn. Persistent unmet demand means room to expand into this market.">
          <div
            className={`text-sm font-bold tabular-nums ${
              flows.unmetDemandUnits > 0 ? "text-error" : "text-muted"
            }`}
          >
            {formatUnits(flows.unmetDemandUnits, unit)}
          </div>
          <div className="text-[10px] text-muted mt-0.5">Unmet demand</div>
        </div>
        <div title="Output that found no buyer this turn. A surplus that lasts pushes prices down, which means producers here have built too much.">
          <div
            className={`text-sm font-bold tabular-nums ${
              flows.surplusUnits > 0 ? "text-warning" : "text-muted"
            }`}
          >
            {formatUnits(flows.surplusUnits, unit)}
          </div>
          <div className="text-[10px] text-muted mt-0.5">Unsold</div>
        </div>
        {flows.stockUnits != null && (
          <div title="Global stockpile after this turn's flows and spoilage. Not yet affecting prices.">
            <div className="text-sm font-bold tabular-nums text-foreground">
              {formatUnits(flows.stockUnits, unit)}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Stock</div>
          </div>
        )}
        {flows.stockUnits != null && (
          <div title="How many turns the current stockpile would satisfy demand with zero production. Low cover means a shock reprices fast; high cover means an overhang.">
            <div
              className={`text-sm font-bold tabular-nums ${
                flows.coverTurns == null
                  ? "text-muted"
                  : flows.coverTurns < 6
                    ? "text-error"
                    : flows.coverTurns > 60
                      ? "text-warning"
                      : "text-foreground"
              }`}
            >
              {flows.coverTurns == null ? "—" : `${flows.coverTurns}t`}
            </div>
            <div className="text-[10px] text-muted mt-0.5">Cover</div>
          </div>
        )}
      </div>
    </div>
  );
}
