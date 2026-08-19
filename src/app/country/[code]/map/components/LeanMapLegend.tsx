"use client";

import { leanRampStops } from "@/lib/utils/politics";
import type { LeanAxis } from "./mapShared";

const AXIS_COPY: Record<LeanAxis, { title: string; negative: string; positive: string }> = {
  economic: { title: "Economic lean", negative: "Left", positive: "Right" },
  social: { title: "Social lean", negative: "Liberal", positive: "Traditional" },
  display: { title: "Combined lean", negative: "Left / Liberal", positive: "Right / Traditional" },
};

/**
 * Colour-scale legend for the lean map modes. The gradient reuses the shared
 * 11-stop ideology ramp; endpoints are the fitted half-range (largest |lean|
 * currently shown), not the full −5…+5 ruler, so the caption states the scale
 * explicitly.
 */
export function LeanMapLegend({
  axis,
  halfRange,
  european = false,
}: {
  axis: LeanAxis;
  halfRange: number;
  european?: boolean;
}) {
  const copy = AXIS_COPY[axis];
  const stops = leanRampStops(axis === "social" ? "social" : "economic", european);
  const gradient = `linear-gradient(to right, ${stops.join(", ")})`;
  const range = halfRange.toFixed(1);

  return (
    <div className="mt-3 w-full max-w-md">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{copy.negative}</span>
        <span className="font-medium text-foreground">{copy.title}</span>
        <span>{copy.positive}</span>
      </div>
      <div
        className="mt-1 h-2.5 rounded-full border border-card-border/60"
        style={{ background: gradient }}
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted tabular-nums">
        <span>−{range}</span>
        <span>0 · center</span>
        <span>+{range}</span>
      </div>
      <p className="mt-1 text-[10px] text-muted">
        Scale fitted to the current spread across regions on the −5…+5 position ruler. Hover a
        region for exact values; click one for its demographic breakdown.
      </p>
    </div>
  );
}
