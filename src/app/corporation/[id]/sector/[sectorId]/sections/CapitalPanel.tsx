"use client";

import type { ReactNode } from "react";
import { InfoTooltip } from "@/components/InfoTooltip";
import type { CapitalData } from "../types";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

/** Tap-friendly info icon for the capacity tiles (works on mobile, unlike title=). */
function TileInfo({ children }: { children: ReactNode }) {
  return (
    <InfoTooltip trigger={<span className="cursor-help text-muted">ⓘ</span>} width={260}>
      <p className="text-muted text-xs normal-case">{children}</p>
    </InfoTooltip>
  );
}

interface CapitalPanelProps {
  capital: CapitalData;
}

/**
 * Capital & unit economics (marketSystemMode >= "capital", audit t806 Fix 4
 * v1). Surfaces the game-design loop, not just numbers: capacity is what you
 * own, investment is what maintains it, and margin is something the market
 * computes about you — not a stat you were assigned.
 */
export default function CapitalPanel({ capital }: CapitalPanelProps) {
  const coverage = capital.capacityCoverage;
  const unit = capital.unit;
  const breakeven =
    unit.labour != null || unit.inputs != null || unit.capitalCharge != null
      ? (unit.labour ?? 0) + (unit.inputs ?? 0) + (unit.capitalCharge ?? 0)
      : null;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-bold text-foreground">Capital &amp; Unit Economics</h2>
        {coverage != null && (
          <InfoTooltip
            trigger={
              <span
                className={`text-xs font-semibold tabular-nums underline decoration-dotted underline-offset-2 ${
                  coverage >= 0.999
                    ? "text-success"
                    : coverage >= 0.8
                      ? "text-warning"
                      : "text-error"
                }`}
              >
                {Math.round(coverage * 100)}% capacity coverage
              </span>
            }
            width={280}
          >
            <p className="text-muted text-xs">
              How much of the output you need your equipment can actually make. Below 100% means
              people want more than you can produce, so invest.
            </p>
          </InfoTooltip>
        )}
      </div>
      <p className="text-xs text-muted mb-4">
        This sector owns the equipment it produces with. Your growth budget is <b>investment</b>: it
        builds more capacity. Stop investing and that capacity slowly wears out, and your output
        falls with it.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-card-border bg-background/40 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Capacity
            <TileInfo>
              Productive capacity: the most output this sector&apos;s capital can produce per day.
            </TileInfo>
          </div>
          <div className="text-sm font-bold tabular-nums mt-0.5">
            {fmt(capital.stock, 0)} <span className="text-[10px] text-muted">units/day</span>
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-background/40 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Potential output
            <TileInfo>
              What your revenue base implies you&apos;d produce at full throughput today.
            </TileInfo>
          </div>
          <div className="text-sm font-bold tabular-nums mt-0.5">
            {fmt(capital.impliedUnits, 0)} <span className="text-[10px] text-muted">units/day</span>
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-background/40 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Capacity used
            <TileInfo>
              Productive capacity required by today&apos;s potential output. The remainder is spare.
            </TileInfo>
          </div>
          <div className="text-sm font-bold tabular-nums mt-0.5">
            {fmt(capital.capacityUsed, 0)} <span className="text-[10px] text-muted">units/day</span>
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-background/40 p-3">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Depreciation
            <TileInfo>
              Capacity lost per turn when you don&apos;t invest. Your growth budget must at least
              cover this to stand still.
            </TileInfo>
          </div>
          <div className="text-sm font-bold tabular-nums mt-0.5">
            −{(capital.depreciationPerTurn * 100).toFixed(2)}
            <span className="text-[10px] text-muted">%/turn</span>
          </div>
        </div>
      </div>

      <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
        Profit and loss on one unit
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between tabular-nums">
          <span className="text-muted">Market price / unit</span>
          <span className="font-medium">₳ {fmt(unit.price)}</span>
        </div>
        {unit.labour != null && (
          <div className="flex justify-between tabular-nums">
            <span className="text-muted">Labour</span>
            <span className="font-medium text-error">− ₳ {fmt(unit.labour)}</span>
          </div>
        )}
        <div className="flex justify-between tabular-nums">
          <span className="text-muted">Purchased inputs</span>
          <span className="font-medium text-error">− ₳ {fmt(unit.inputs)}</span>
        </div>
        <div className="flex justify-between tabular-nums">
          <span className="text-muted">Capital charge</span>
          <span className="font-medium text-error">− ₳ {fmt(unit.capitalCharge)}</span>
        </div>
        <div className="flex justify-between tabular-nums pt-2 border-t border-card-border">
          <InfoTooltip
            trigger={
              <span className="text-muted border-b border-dotted border-muted/40 cursor-default">
                Profit per unit
              </span>
            }
            width={300}
          >
            <p className="text-muted text-xs">
              Price minus labour, inputs and the cost of your equipment, for each unit you make. The
              market sets this, not you. It moves when input prices spike, wages rise, or your
              machines sit idle.
              {breakeven != null && unit.price != null && (
                <>
                  {" "}
                  Breakeven price:{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    ₳ {fmt(breakeven)}
                  </span>
                  . Below this, every unit you sell loses money and investing stops paying off.
                </>
              )}
            </p>
          </InfoTooltip>
          <span
            className={`font-bold tabular-nums ${
              unit.margin == null ? "text-muted" : unit.margin > 0 ? "text-success" : "text-error"
            }`}
          >
            {unit.margin == null ? "—" : `₳ ${fmt(unit.margin)}`}
          </span>
        </div>
      </div>

      {coverage == null && unit.margin == null && (
        <p className="mt-3 text-[11px] italic text-muted">
          Capacity and unit economics appear after the next turn.
        </p>
      )}
    </div>
  );
}
