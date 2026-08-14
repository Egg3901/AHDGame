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
 * Reachable-market diverging scale (ticket #1077).
 *
 * The data's job here is POLARITY, not magnitude: which side of a balanced
 * market (demand/supply = 1) a country sits on. So it takes two hues and a
 * NEUTRAL GRAY midpoint, never a rainbow and never a hue at the middle.
 *
 * Poles are the ones `ShortageHeatMap` already ships (#D64545 warm shortage,
 * #3E7CB1 cool glut, #8A8F98 neutral) so the world map and the heat map read as
 * one system. Each arm was solved for even OKLCH lightness spacing and checked
 * with the dataviz `validateOrdinal` in BOTH light and dark mode: lightness
 * monotone, adjacent dL >= 0.06, light end clears the surface, single hue per
 * arm. The categorical validator FAILS a correct diverging ramp by design (it
 * spans the lightness band and the gray midpoint sits under the chroma floor),
 * so it is not the check that applies here.
 *
 * One validated mid-tone set serves every theme, matching the reasoning in
 * ShortageHeatMap: the app ships 10+ named data-theme surfaces, so a per-theme
 * override would mis-fire on the themes it does not name.
 */
const REACHABLE_SHORT_STEPS = ["#e68f8f", "#dd6363", "#c44040", "#973535"] as const;
const REACHABLE_GLUT_STEPS = ["#8ab0d0", "#6294c0", "#3d79ad", "#325f85"] as const;
const REACHABLE_NEUTRAL = "#8A8F98";
/** Ratio band treated as balanced, matching ShortageHeatMap's tone thresholds. */
const REACHABLE_BALANCED_LO = 0.85;
const REACHABLE_BALANCED_HI = 1.15;

/**
 * Which arm and step a demand/supply ratio lands on. Exported for the legend
 * and for tests, so the buckets cannot drift from the fill.
 *
 * `null` ratio means no signal at all (no book, or zero on both sides) and is
 * deliberately NOT painted as balanced — an unknown market and a balanced one
 * are different answers.
 */
export function reachableBucket(dsRatio: number | null): {
  arm: "short" | "glut" | "balanced" | "unknown";
  step: number;
} {
  if (dsRatio == null || !Number.isFinite(dsRatio) || dsRatio <= 0) {
    return { arm: "unknown", step: 0 };
  }
  if (dsRatio >= REACHABLE_BALANCED_LO && dsRatio <= REACHABLE_BALANCED_HI) {
    return { arm: "balanced", step: 0 };
  }
  // Steps at 1.15/1.5/2/3x on the short arm, mirrored on the glut arm, so each
  // step is a doubling-ish of imbalance rather than a linear slice that puts
  // every real market in one bucket.
  if (dsRatio > REACHABLE_BALANCED_HI) {
    const step = dsRatio >= 3 ? 3 : dsRatio >= 2 ? 2 : dsRatio >= 1.5 ? 1 : 0;
    return { arm: "short", step };
  }
  const inv = 1 / dsRatio;
  const step = inv >= 3 ? 3 : inv >= 2 ? 2 : inv >= 1.5 ? 1 : 0;
  return { arm: "glut", step };
}

/** Fill for a country on the reachable lens. */
export function reachableColor(dsRatio: number | null): string {
  const { arm, step } = reachableBucket(dsRatio);
  if (arm === "unknown") return "rgba(148, 163, 184, 0.10)";
  if (arm === "balanced") return REACHABLE_NEUTRAL;
  return arm === "short" ? REACHABLE_SHORT_STEPS[step] : REACHABLE_GLUT_STEPS[step];
}

/** Legend stops for the reachable lens, glut -> balanced -> shortage. */
export function getReachableLegendStops(): { color: string; label: string }[] {
  return [
    { color: REACHABLE_GLUT_STEPS[3], label: "Glut" },
    { color: REACHABLE_GLUT_STEPS[1], label: "" },
    { color: REACHABLE_NEUTRAL, label: "Balanced" },
    { color: REACHABLE_SHORT_STEPS[1], label: "" },
    { color: REACHABLE_SHORT_STEPS[3], label: "Shortage" },
  ];
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
