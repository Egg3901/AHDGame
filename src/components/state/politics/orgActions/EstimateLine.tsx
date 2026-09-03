"use client";

import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";

export interface EstimateLineProps {
  /** Optional leading label, e.g. "Build" / "Contest". */
  label?: string;
  /** PS cost (effective, incl. ladder). */
  costPS: number;
  /**
   * Cash cost alongside the PS, in the paying tier's local currency. Omitted by
   * actions that cost no money; Build Org has charged treasury since 2026-09-02.
   */
  costCash?: { amount: number; currencyCode: string };
  gain: { sign: "+" | "−"; value: number; unit: string };
  /** Optional trailing text, e.g. "vs SSP". */
  suffix?: string;
  /** Color accent. */
  tone?: "build" | "contest";
}

/**
 * Compact one-line cost/gain readout — `{label}: Est. N PS · ±X unit {suffix}`.
 * Used where a full `EstimateBox` doesn't fit: the Quick Actions hub and the
 * Overview "Org Pool" card. Pure presentational; the caller supplies the
 * already-resolved preview values.
 */
export function EstimateLine({
  label,
  costPS,
  costCash,
  gain,
  suffix,
  tone = "build",
}: EstimateLineProps) {
  const color = tone === "contest" ? "text-error/90" : "text-success/90";
  const cash = costCash
    ? ` · ${CURRENCY_SYMBOLS[costCash.currencyCode as keyof typeof CURRENCY_SYMBOLS] ?? "$"}${Math.round(costCash.amount).toLocaleString("en-US")}`
    : "";
  return (
    <span className={`block text-[10px] font-medium tabular-nums ${color}`}>
      {label ? `${label}: ` : ""}Est. {costPS.toFixed(0)} PS{cash} · {gain.sign}
      {gain.value.toFixed(2)} {gain.unit}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}
