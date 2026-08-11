import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";

/** The formatting-relevant subset of a metric definition. */
export interface MetricFormat {
  formatPrefix?: string;
  formatSuffix?: string;
  decimals?: number;
}

/**
 * Format a metric value for display, honoring the metric's prefix/suffix and
 * decimals. A "$" prefix is rewritten to the country's local-currency symbol
 * when a countryId is supplied (matching the existing MetricCard behavior).
 */
export function formatMetricValue(def: MetricFormat, value: number, countryId?: string): string {
  const decimals = def.decimals ?? 1;
  const prefix =
    def.formatPrefix === "$" && countryId ? getCurrencyPrefix(countryId) : (def.formatPrefix ?? "");
  const num = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${prefix}${num}${def.formatSuffix ?? ""}`;
}
