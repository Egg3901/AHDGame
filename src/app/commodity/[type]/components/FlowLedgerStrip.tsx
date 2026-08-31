"use client";

import { formatUnits } from "../lib/helpers";
import type { CommodityDetail } from "../types";

/**
 * Flow-ledger summary (marketSystemMode >= "ledger", audit t806 Fix 3/D0):
 * pooled world availability last turn. These figures are a frictionless global
 * aggregate, not state buyer intent or route-level physical settlement. Hidden
 * entirely when the ledger is off (`flows` absent).
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
          Global pooled ledger
        </span>
        <span className="text-[10px] text-muted tabular-nums">turn {flows.turn}</span>
      </div>
      <div
        className={`grid gap-3 text-center ${
          flows.stockUnits != null ? "grid-cols-2 sm:grid-cols-5" : "grid-cols-3"
        }`}
      >
        <div title="Pooled availability: the smaller of world supply and world ledger demand. This does not apply route or country reachability.">
          <div className="text-sm font-bold tabular-nums text-foreground">
            {formatUnits(flows.clearedUnitsPooled, unit)}
          </div>
          <div className="text-[10px] text-muted mt-0.5">Could clear</div>
        </div>
        <div title="Calibrated world ledger demand above world supply. Reachable buyer intent can be higher because this pool ignores location and delivery limits.">
          <div
            className={`text-sm font-bold tabular-nums ${
              flows.unmetDemandUnitsPooled > 0 ? "text-error" : "text-muted"
            }`}
          >
            {formatUnits(flows.unmetDemandUnitsPooled, unit)}
          </div>
          <div className="text-[10px] text-muted mt-0.5">Pooled unmet</div>
        </div>
        <div title="World supply above calibrated world ledger demand. This pooled estimate does not apply route or country reachability.">
          <div
            className={`text-sm font-bold tabular-nums ${
              flows.surplusUnitsPooled > 0 ? "text-warning" : "text-muted"
            }`}
          >
            {formatUnits(flows.surplusUnitsPooled, unit)}
          </div>
          <div className="text-[10px] text-muted mt-0.5">Pooled surplus</div>
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
