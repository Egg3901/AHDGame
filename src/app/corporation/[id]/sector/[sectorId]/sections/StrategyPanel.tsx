"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import StrategyChangeConfirm from "@/components/corporation/StrategyChangeConfirm";
import { SECTOR_STRATEGIES, STRATEGY_TRANSITION_TURNS } from "@/lib/constants/sectorStrategies";
import { isExtractionStrategyZeroYield } from "@/lib/corporations/extractionStrategyAvailability";
import type {
  StrategyData,
  SectorData,
  CorporationRef,
  AvailableStrategy,
  Financials,
  Margins,
} from "../types";

/** Whole-unit capacity count for the D9 retool preview. */
function formatUnitCount(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

interface StrategyPanelProps {
  strategy: StrategyData;
  sector: SectorData;
  corporation: CorporationRef;
  isCeo: boolean;
  strategyUpdating: boolean;
  cancelTransitionLoading: boolean;
  onStrategyChange: (strategyId: string) => void;
  onCancelTransition: () => void;
  stateResources?: Partial<Record<string, number>> | null;
  /** Current financials/margins — the baseline every projection is diffed from. */
  financials?: Financials | null;
  margins?: Margins | null;
  /**
   * Plants tier (D9): the sector's installed capacity, units/day. When present
   * the picker shows what each strategy would re-denominate that capacity to —
   * retooling changes the output mix, so the same value of plant is a different
   * NUMBER of units. Absent below plants, where the row is meaningless.
   */
  plantsCapacityUnits?: number | null;
}

/**
 * A strategy's whole effect is the commodity supply/demand mix it imposes, which
 * lands on BOTH the effective margin and realized revenue. Combine the two legs
 * into the one number the decision actually turns on: the change in daily
 * operating profit. Without this a player has to weigh "more revenue vs the loss
 * in profit margin" in their head with neither figure shown — the complaint
 * OGBuildz raised in #gameplay-advisors on 2026-07-29.
 */
export function projectStrategyOutcome(
  s: AvailableStrategy,
  currentRealizedRevenue: number | null,
  currentEffectiveMargin: number | null
): { projectedMargin: number; profitDelta: number } | null {
  if (
    currentRealizedRevenue == null ||
    currentEffectiveMargin == null ||
    s.projectedMarginDelta == null
  ) {
    return null;
  }
  const projectedMargin = currentEffectiveMargin + s.projectedMarginDelta;
  const projectedRevenue = currentRealizedRevenue * (1 + (s.projectedRealizationDelta ?? 0));
  const currentProfit = (currentRealizedRevenue * currentEffectiveMargin) / 100;
  const projectedProfit = (projectedRevenue * projectedMargin) / 100;
  return { projectedMargin, profitDelta: projectedProfit - currentProfit };
}

function DeltaCell({
  value,
  format,
  title,
}: {
  value: number | null | undefined;
  format: (v: number) => string;
  title?: string;
}) {
  if (value == null) return <span className="text-muted/50">—</span>;
  // Treat anything that rounds to nothing as flat rather than showing "+0.0".
  const flat = Math.abs(value) < 0.05;
  return (
    <span
      className={`tabular-nums ${flat ? "text-muted" : value > 0 ? "text-success" : "text-error"}`}
      title={title}
    >
      {flat ? "—" : `${value > 0 ? "+" : ""}${format(value)}`}
    </span>
  );
}

export default function StrategyPanel({
  strategy,
  sector,
  corporation,
  isCeo,
  strategyUpdating,
  cancelTransitionLoading,
  onStrategyChange,
  onCancelTransition,
  stateResources,
  financials,
  margins,
  plantsCapacityUnits,
}: StrategyPanelProps) {
  const { formatAmount } = useCurrency();
  // strategy.retoolCost / cancelCost are returned in ₳ by the API (see
  // sectors/[sectorId]/route.ts Task 38 fix); formatAmount treats them as ₳
  // and honors wallet-pref display via the corp's liquidCurrencyCode.
  const liquidCode = corporation.liquidCurrencyCode as
    import("@/lib/constants/currencies").CurrencyCode | undefined;
  const [pendingStrategyId, setPendingStrategyId] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const fromStrategyName =
    strategy.availableStrategies.find((s) => s.id === strategy.transitionFromStrategyId)?.name ??
    "Previous";

  const pct =
    strategy.transitionProgress != null ? Math.round(strategy.transitionProgress * 100) : 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-1">Operating Strategy</h2>
      <p className="text-xs text-muted mb-4">
        Changes commodity inputs and outputs. Switching costs{" "}
        {formatAmount(strategy.retoolCost, liquidCode)} and takes 12 turns to complete.
      </p>
      {plantsCapacityUnits != null && plantsCapacityUnits > 0 && (
        <p className="mb-4 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-foreground">
          Retooling does not scrap or build anything. Your {formatUnitCount(plantsCapacityUnits)}{" "}
          units of capacity are re-counted in the new mix at the same value, so the unit number
          changes. Each option below shows what you would hold.
        </p>
      )}

      {/* Current strategy name + transition badge */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm font-medium text-foreground">{strategy.currentStrategyName}</span>

        {strategy.isTransitioning && !strategy.isReversing && (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
            {fromStrategyName} → {strategy.currentStrategyName} ({pct}%)
          </span>
        )}

        {strategy.isTransitioning && strategy.isReversing && (
          <span className="inline-flex items-center gap-1 rounded-full border border-error/30 bg-error/10 px-2.5 py-0.5 text-xs font-medium text-error">
            Reversing → {strategy.currentStrategyName} ({pct}%)
          </span>
        )}

        {strategy.cooldownRemaining > 0 && !strategy.isTransitioning && (
          <span className="ml-1 text-xs text-muted">
            Cooldown: {strategy.cooldownRemaining} turns
          </span>
        )}
      </div>

      {/* Transition progress bar */}
      {strategy.isTransitioning && strategy.transitionProgress != null && (
        <div className="mb-4">
          <div className="h-2 rounded-full bg-card-elevated overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${strategy.isReversing ? "bg-error" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] text-warning mt-1">
            −{strategy.transitionMarginPenalty.toFixed(1)}% margin penalty during transition
          </p>
        </div>
      )}

      {/* Cancel transition (CEO only, forward transition only) */}
      {isCeo && strategy.isTransitioning && !strategy.isReversing && (
        <div className="mb-4">
          {!showCancelConfirm ? (
            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              disabled={cancelTransitionLoading}
              className="rounded-lg border border-error/30 bg-error/10 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
            >
              Cancel Transition ({formatAmount(strategy.cancelCost, liquidCode)})
            </button>
          ) : (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3 space-y-2">
              <p className="text-xs font-medium text-error">Cancel this transition?</p>
              <p className="text-[11px] text-muted">
                Cost: {formatAmount(strategy.cancelCost, liquidCode)} · Reversal: ~
                {strategy.reversalTurns} turns · Cannot cancel again once reversing.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCancelConfirm(false);
                    onCancelTransition();
                  }}
                  disabled={cancelTransitionLoading}
                  className="rounded-lg bg-error px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-error/80 disabled:opacity-50"
                >
                  {cancelTransitionLoading ? "Cancelling..." : "Confirm Cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={cancelTransitionLoading}
                  className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Strategy selector (CEO only, no active transition or cooldown) */}
      {isCeo && !strategy.isTransitioning && strategy.cooldownRemaining <= 0 && (
        <div className="space-y-3">
          {/* Comparison table — margin and revenue legs plus the combined effect */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-card-border text-[10px] uppercase tracking-widest text-muted">
                  <th className="py-1.5 pr-2 text-left font-semibold">Strategy</th>
                  <th
                    className="px-2 py-1.5 text-right font-semibold"
                    title="Change to effective profit margin at today's commodity prices"
                  >
                    Margin
                  </th>
                  <th
                    className="px-2 py-1.5 text-right font-semibold"
                    title="Change to realized revenue via price realization at today's commodity prices"
                  >
                    Revenue
                  </th>
                  <th
                    className="py-1.5 pl-2 text-right font-semibold"
                    title="Combined effect on daily operating profit — margin and revenue together"
                  >
                    Net / day
                  </th>
                </tr>
              </thead>
              <tbody>
                {strategy.availableStrategies.map((s) => {
                  const isCurrent = s.id === strategy.currentStrategyId;
                  const isPending = s.id === pendingStrategyId;
                  const zeroYield =
                    sector.sectorType === "extraction" &&
                    isExtractionStrategyZeroYield(
                      (SECTOR_STRATEGIES["extraction"] ?? []).find(
                        (strategy) => strategy.id === s.id
                      ) ?? { supply: {} },
                      stateResources
                    );
                  const unavailable = zeroYield || !!s.locked;
                  const outcome = isCurrent
                    ? null
                    : projectStrategyOutcome(
                        s,
                        financials?.realizedRevenue ?? financials?.revenue ?? null,
                        margins?.effective ?? null
                      );
                  return (
                    <tr
                      key={s.id}
                      onClick={() => {
                        if (strategyUpdating || unavailable || isCurrent) return;
                        setPendingStrategyId(isPending ? null : s.id);
                      }}
                      // The old picker was a list of <button>s. Rows are not
                      // focusable by default, so restore keyboard selection
                      // explicitly rather than dropping it for the table layout.
                      onKeyDown={(e) => {
                        if (strategyUpdating || unavailable || isCurrent) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPendingStrategyId(isPending ? null : s.id);
                        }
                      }}
                      tabIndex={strategyUpdating || unavailable || isCurrent ? -1 : 0}
                      role="button"
                      aria-disabled={strategyUpdating || unavailable || isCurrent}
                      aria-label={`Select ${s.name} strategy`}
                      aria-pressed={isPending}
                      className={`border-b border-card-border/40 transition-colors ${
                        isCurrent
                          ? "bg-primary/10"
                          : unavailable
                            ? "opacity-40"
                            : isPending
                              ? "cursor-pointer bg-primary/5"
                              : "cursor-pointer hover:bg-card-elevated/50"
                      }`}
                    >
                      <td className="py-2 pr-2">
                        <span className="block font-medium text-foreground">{s.name}</span>
                        <span className="block text-[10px] text-muted">
                          {isCurrent
                            ? "current"
                            : zeroYield
                              ? "no deposits in this state"
                              : s.locked
                                ? (s.lockReason ?? "locked")
                                : s.projectedRevenuePerTurn != null
                                  ? `≈ ${formatAmount(s.projectedRevenuePerTurn, liquidCode)}/turn gross`
                                  : ""}
                        </span>
                        {plantsCapacityUnits != null &&
                          plantsCapacityUnits > 0 &&
                          !isCurrent &&
                          !unavailable &&
                          s.capacityAfterRetool != null && (
                            <span className="block text-[10px] tabular-nums text-info">
                              {formatUnitCount(s.capacityAfterRetool)} units after retool
                            </span>
                          )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {isCurrent ? (
                          <span className="tabular-nums text-muted">
                            {margins?.effective != null ? `${margins.effective}%` : "—"}
                          </span>
                        ) : unavailable ? (
                          <span className="text-muted/50">—</span>
                        ) : (
                          <DeltaCell
                            value={s.projectedMarginDelta}
                            format={(v) => `${v.toFixed(1)}pp`}
                            title={
                              outcome
                                ? `Effective margin would be about ${outcome.projectedMargin.toFixed(1)}%`
                                : undefined
                            }
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {isCurrent || unavailable ? (
                          <span className="text-muted/50">—</span>
                        ) : (
                          <DeltaCell
                            value={
                              s.projectedRealizationDelta != null
                                ? s.projectedRealizationDelta * 100
                                : null
                            }
                            format={(v) => `${v.toFixed(1)}%`}
                          />
                        )}
                      </td>
                      <td className="py-2 pl-2 text-right font-medium">
                        {isCurrent || unavailable || !outcome ? (
                          <span className="text-muted/50">—</span>
                        ) : (
                          <DeltaCell
                            value={outcome.profitDelta}
                            format={(v) => formatAmount(Math.abs(v), liquidCode)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] leading-snug text-muted">
            Projections use today&apos;s commodity prices and assume your current market share.
            Prices move, so treat these as direction and rough size, not a promise. Switching costs{" "}
            {formatAmount(strategy.retoolCost, liquidCode)} and runs a{" "}
            {strategy.transitionMarginPenalty.toFixed(1)}% margin penalty for{" "}
            {STRATEGY_TRANSITION_TURNS} turns.
          </p>

          {pendingStrategyId && sector && (
            <StrategyChangeConfirm
              sectorType={sector.sectorType}
              currentStrategyId={strategy.currentStrategyId}
              targetStrategyId={pendingStrategyId}
              dailyRevenue={sector.revenue ?? 0}
              liquidCurrencyCode={corporation.liquidCurrencyCode}
              loading={strategyUpdating}
              onConfirm={() => {
                onStrategyChange(pendingStrategyId);
                setPendingStrategyId(null);
              }}
              onCancel={() => setPendingStrategyId(null)}
            />
          )}

          {!pendingStrategyId &&
            strategy.availableStrategies
              .filter((s) => s.id === strategy.currentStrategyId)
              .map((s) => (
                <p key={s.id} className="text-xs text-muted">
                  {s.description}
                </p>
              ))}
        </div>
      )}

      {/* Read-only strategy display for non-CEOs */}
      {!isCeo && (
        <div className="space-y-1.5">
          <select
            value={strategy.currentStrategyId}
            disabled
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-medium text-foreground opacity-70 cursor-not-allowed"
          >
            {strategy.availableStrategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {strategy.availableStrategies
            .filter((s) => s.id === strategy.currentStrategyId)
            .map((s) => (
              <p key={s.id} className="text-xs text-muted">
                {s.description}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
