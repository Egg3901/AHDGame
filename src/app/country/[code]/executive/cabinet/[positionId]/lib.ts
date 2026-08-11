import type { MetricFormat } from "@/lib/constants/cabinetMetrics";

export function normalizeMetricValue(value: number, min: number, max: number): number {
  if (max === min) return 50;
  const normalized = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, normalized));
}

export function getBarColor(
  normalizedValue: number,
  higherIsBetter: boolean
): "green" | "amber" | "red" {
  // Flip the effective value so that "good" always means high effective score
  const effective = higherIsBetter ? normalizedValue : 100 - normalizedValue;
  if (effective > 65) return "green";
  if (effective >= 35) return "amber";
  return "red";
}

export function getTrendColor(trend: number, higherIsBetter: boolean): "good" | "bad" | "neutral" {
  if (Math.abs(trend) < 0.1) return "neutral";
  const increasing = trend > 0;
  return increasing === higherIsBetter ? "good" : "bad";
}

export function formatMetricValue(value: number, format: MetricFormat): string {
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "years":
      return `${value.toFixed(1)} yrs`;
    case "currency":
      return value.toLocaleString();
    case "index":
    case "rate":
    case "score":
      return value.toFixed(1);
    case "number":
      return value.toLocaleString();
  }
}

export function trimDescription(description: string): string {
  // Split on ". " followed by a capital letter, but NOT when preceded by an uppercase letter
  // (which indicates an abbreviation like "U.S." or "F.B.I.").
  const parts = description.split(/(?<![A-Z])\. (?=[A-Z])/);
  const first = parts[0];
  const second = parts[1];
  if (!second) return first.endsWith(".") ? first : `${first}.`;
  const trimmed = second.replace(/[.!?]+$/, "");
  return `${first}. ${trimmed}.`;
}
