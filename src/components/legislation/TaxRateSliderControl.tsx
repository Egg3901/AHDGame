"use client";

/**
 * Tax-rate slider (ruling #16): bounded, stepped rate picker with waypoint
 * flavor ticks and a live revenue-delta readout. Used by the propose modal;
 * the read-only variant backs the bill-detail fiscal panel.
 */

import { Slider } from "@/components/ui";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatLocalAmount } from "@/lib/utils/formatters";

export interface TaxSliderEstimatePayload {
  minRate: number;
  maxRate: number;
  step: number;
  baselineRate: number;
  currentRate: number;
  waypoints: Array<{ rate: number; label: string }>;
  revenueDeltaPerPoint: number;
}

function nearestWaypointLabel(
  waypoints: Array<{ rate: number; label: string }>,
  rate: number
): string | null {
  if (waypoints.length === 0) return null;
  let best = waypoints[0];
  for (const wp of waypoints) {
    if (Math.abs(wp.rate - rate) < Math.abs(best.rate - rate)) best = wp;
  }
  return best.label;
}

export function TaxRateSliderControl({
  slider,
  proposedRate,
  currencyCode,
  onChange,
}: {
  slider: TaxSliderEstimatePayload;
  proposedRate: number;
  currencyCode: CurrencyCode;
  onChange: (rate: number) => void;
}) {
  const delta = proposedRate - slider.currentRate;
  const revenueDelta = delta * slider.revenueDeltaPerPoint;
  const isSubStep = Math.abs(delta) < slider.step - 1e-9;
  const waypointLabel = nearestWaypointLabel(slider.waypoints, proposedRate);

  return (
    <div className="space-y-2 rounded-lg border border-card-border bg-background px-3 py-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          Proposed rate: <span className="tabular-nums">{proposedRate}%</span>
        </span>
        <span className="text-xs text-muted tabular-nums">
          Now {slider.currentRate}% · bounds {slider.minRate}–{slider.maxRate}%
        </span>
      </div>
      <Slider
        min={slider.minRate}
        max={slider.maxRate}
        step={slider.step}
        value={proposedRate}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Proposed tax rate"
        variant="primary"
        className="w-full"
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        {waypointLabel ? <span className="italic text-muted">{waypointLabel}</span> : <span />}
        {isSubStep ? (
          <span className="text-muted">Move at least {slider.step} to propose a change</span>
        ) : (
          <span className={revenueDelta >= 0 ? "text-success" : "text-error"}>
            {revenueDelta >= 0 ? "+" : "−"}
            {formatLocalAmount(Math.abs(revenueDelta), currencyCode)}/yr revenue
          </span>
        )}
      </div>
    </div>
  );
}
