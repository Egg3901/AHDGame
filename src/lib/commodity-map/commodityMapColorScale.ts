/**
 * Color scale utilities for commodity map visualizations.
 *
 * Supply uses a green gradient (low → high intensity).
 * Demand uses a red/orange gradient (low → high intensity).
 * Price uses a red/green deviation scale centered on base price.
 */

/**
 * Compute a 0–1 intensity value from a raw value and a max value.
 */
function normalize(value: number, maxValue: number): number {
  if (maxValue <= 0) return 0;
  return Math.min(1, Math.max(0, value / maxValue));
}

/**
 * Supply color: transparent → deep green
 */
export function supplyColor(value: number, maxValue: number): string {
  const t = normalize(value, maxValue);
  if (t === 0) return "rgba(34, 197, 94, 0.08)";
  // Light green → deep green
  const r = Math.round(220 - t * 186);
  const g = Math.round(240 - t * 43);
  const b = Math.round(220 - t * 126);
  const alpha = 0.15 + t * 0.7;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Demand color: transparent → deep red/orange
 */
export function demandColor(value: number, maxValue: number): string {
  const t = normalize(value, maxValue);
  if (t === 0) return "rgba(239, 68, 68, 0.08)";
  // Light red → deep red
  const r = Math.round(250 - t * 11);
  const g = Math.round(200 - t * 132);
  const b = Math.round(200 - t * 132);
  const alpha = 0.15 + t * 0.7;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Get the appropriate color for a given value and mode.
 */
export function commodityColor(value: number, maxValue: number, mode: "supply" | "demand"): string {
  return mode === "supply" ? supplyColor(value, maxValue) : demandColor(value, maxValue);
}

/**
 * Price color: green below base, red above base, neutral at base.
 * `maxDeviation` is the maximum absolute percentage deviation used to normalize the scale.
 */
export function priceColor(price: number, basePrice: number, maxDeviation: number): string {
  if (basePrice <= 0) return "rgba(148, 163, 184, 0.15)";
  const deviation = ((price - basePrice) / basePrice) * 100;
  const span = Math.max(1, maxDeviation);
  const rawT = Math.min(1, Math.abs(deviation) / span);
  // Compress the scale so the highest-priced outliers do not dominate the map.
  const t = Math.pow(rawT, 0.7);
  if (t === 0) return "rgba(148, 163, 184, 0.15)";
  if (deviation >= 0) {
    // Above base = scarcer / more expensive = red
    const r = Math.round(214 + t * 26);
    const g = Math.round(214 - t * 82);
    const b = Math.round(214 - t * 82);
    const alpha = 0.12 + t * 0.52;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // Below base = cheaper / more abundant = green
  const r = Math.round(214 - t * 82);
  const g = Math.round(214 + t * 26);
  const b = Math.round(214 - t * 82);
  const alpha = 0.12 + t * 0.52;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Capacity color: transparent → deep amber (extraction deposit ceiling)
 */
export function capacityColor(value: number, maxValue: number): string {
  const t = Math.min(1, Math.max(0, maxValue <= 0 ? 0 : value / maxValue));
  if (t === 0) return "rgba(245, 158, 11, 0.08)";
  const r = Math.round(245 - t * 10);
  const g = Math.round(200 - t * 90);
  const b = Math.round(50 - t * 30);
  const alpha = 0.15 + t * 0.7;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Generate legend stops for display.
 */
export function getLegendStops(mode: "supply" | "demand"): { color: string; label: string }[] {
  if (mode === "supply") {
    return [
      { color: "rgba(34, 197, 94, 0.15)", label: "Low" },
      { color: "rgba(34, 197, 94, 0.5)", label: "" },
      { color: "rgba(34, 197, 94, 0.85)", label: "High" },
    ];
  }
  return [
    { color: "rgba(239, 68, 68, 0.15)", label: "Low" },
    { color: "rgba(239, 68, 68, 0.5)", label: "" },
    { color: "rgba(239, 68, 68, 0.85)", label: "High" },
  ];
}

export function getPriceLegendStops(): { color: string; label: string }[] {
  return [
    { color: "rgba(34, 197, 94, 0.12)", label: "Below" },
    { color: "rgba(148, 163, 184, 0.25)", label: "" },
    { color: "rgba(239, 68, 68, 0.7)", label: "Above" },
  ];
}
