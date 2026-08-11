/**
 * JP/IE/CN/BR (and NG birthRate) 1953 demography overlays.
 *
 * A widened adjuster band only stops modern median ages being destroyed; it
 * cannot invent the right value. These countries still resolved modern-era
 * ages (JP 36, IE 38.6, CN 30 authored-wrong, BR ~24) until the 1953 metric
 * presets authored UN WPP-anchored medianAge / fertility-index birthRate.
 */
import { describe, expect, it } from "vitest";
import { applyMetricPresetToMetrics, getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { applyEra1953Adjustments } from "@/lib/seeds/reference/stateMetricsEra1953";
import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";
import { ieStateMetrics } from "@/lib/seeds/ie/ieStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { brStateMetrics } from "@/lib/seeds/br/brStateMetrics";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";

/** Defensible 1953 national bands around UN WPP 1950 medians. */
const MEDIAN_AGE_BANDS: Record<
  "JP" | "IE" | "CN" | "BR",
  { lo: number; hi: number; sampleRegion: string }
> = {
  JP: { lo: 20, hi: 25, sampleRegion: "KAN" }, // UN WPP 1950 ≈ 22.3
  IE: { lo: 28, hi: 33, sampleRegion: "DUB" }, // UN WPP 1950 ≈ 30.0
  CN: { lo: 20, hi: 26, sampleRegion: "HD" }, // UN WPP 1950 ≈ 23.9
  BR: { lo: 16, hi: 22, sampleRegion: "SUDESTE" }, // UN WPP 1950 ≈ 19.2
};

function resolve1953(
  country: CountryId,
  metrics: StateMetrics[],
  useAdjuster: boolean
): StateMetrics[] {
  return metrics.map((m) => {
    let next = useAdjuster ? applyEra1953Adjustments(m) : structuredClone(m);
    const overlay = getRegionMetricPresets(country, String(m._id), "1953-default");
    if (overlay) next = applyMetricPresetToMetrics(next, overlay);
    return next;
  });
}

describe("1953 demography overlays — JP/IE/CN/BR medianAge", () => {
  it.each([
    ["JP", jpStateMetrics, true] as const,
    ["IE", ieStateMetrics, false] as const, // seedIE never runs the 1953 adjuster
    ["CN", cnStateMetrics, false] as const, // seedCN never runs the 1953 adjuster
    ["BR", brStateMetrics, true] as const,
  ])("%s resolves medianAge inside the UN-anchored 1953 band", (cc, metrics, useAdjuster) => {
    const band = MEDIAN_AGE_BANDS[cc];
    const resolved = resolve1953(cc, metrics, useAdjuster);
    expect(resolved.length).toBeGreaterThan(0);
    for (const m of resolved) {
      const age = m.population?.medianAge?.value;
      expect(age, `${cc}/${m._id}`).toBeTypeOf("number");
      expect(age!).toBeGreaterThanOrEqual(band.lo);
      expect(age!).toBeLessThanOrEqual(band.hi);
    }
  });

  it("authored overlay wins after adjuster-then-overlay (JP/BR) or base-then-overlay (IE/CN)", () => {
    // JP: modern KAN medianAge 45.5 → adjuster clamp(45.5−8)=36 → overlay 24
    const jpKan = jpStateMetrics.find((m) => m._id === "KAN")!;
    expect(jpKan.population!.medianAge!.value).toBeGreaterThan(40);
    const jpAdj = applyEra1953Adjustments(jpKan);
    expect(jpAdj.population!.medianAge!.value).toBe(36);
    const jpOverlay = getRegionMetricPresets("JP", "KAN", "1953-default")!;
    expect(jpOverlay["population.medianAge"]).toBe(24);
    const jpFinal = applyMetricPresetToMetrics(jpAdj, jpOverlay);
    expect(jpFinal.population!.medianAge!.value).toBe(24);

    // BR: modern SUDESTE ~33.5 → adjuster 25.5 → overlay 21
    const brSe = brStateMetrics.find((m) => m._id === "SUDESTE")!;
    const brAdj = applyEra1953Adjustments(brSe);
    expect(brAdj.population!.medianAge!.value).toBe(25.5);
    const brOverlay = getRegionMetricPresets("BR", "SUDESTE", "1953-default")!;
    expect(brOverlay["population.medianAge"]).toBe(21);
    expect(applyMetricPresetToMetrics(brAdj, brOverlay).population!.medianAge!.value).toBe(21);

    // IE: modern 38.6, no adjuster — overlay alone must win
    const ieDub = ieStateMetrics.find((m) => m._id === "DUB")!;
    expect(ieDub.population!.medianAge!.value).toBe(38.6);
    const ieOverlay = getRegionMetricPresets("IE", "DUB", "1953-default")!;
    expect(ieOverlay["population.medianAge"]).toBe(32);
    expect(applyMetricPresetToMetrics(ieDub, ieOverlay).population!.medianAge!.value).toBe(32);

    // CN: prior authored overlay was the wrong 30; now 25 on HD
    const cnHd = cnStateMetrics.find((m) => m._id === "HD")!;
    const cnOverlay = getRegionMetricPresets("CN", "HD", "1953-default")!;
    expect(cnOverlay["population.medianAge"]).toBe(25);
    expect(applyMetricPresetToMetrics(cnHd, cnOverlay).population!.medianAge!.value).toBe(25);
  });

  it("capital/industrial regions are older than rural ones", () => {
    expect(
      getRegionMetricPresets("JP", "KAN", "1953-default")!["population.medianAge"]
    ).toBeGreaterThan(getRegionMetricPresets("JP", "TOH", "1953-default")!["population.medianAge"]);
    expect(
      getRegionMetricPresets("IE", "DUB", "1953-default")!["population.medianAge"]
    ).toBeGreaterThan(getRegionMetricPresets("IE", "GAL", "1953-default")!["population.medianAge"]);
    expect(
      getRegionMetricPresets("CN", "HD", "1953-default")!["population.medianAge"]
    ).toBeGreaterThan(getRegionMetricPresets("CN", "XN", "1953-default")!["population.medianAge"]);
    expect(
      getRegionMetricPresets("BR", "SUDESTE", "1953-default")!["population.medianAge"]
    ).toBeGreaterThan(
      getRegionMetricPresets("BR", "NORTE", "1953-default")!["population.medianAge"]
    );
  });
});

describe("1953 demography overlays — NG birthRate fertility index", () => {
  it("NG birthRate lands in the high-fertility index band [82, 92], not formula ~56", () => {
    const resolved = resolve1953("NG", ngStateMetrics, true);
    for (const m of resolved) {
      const birth = m.population?.birthRate?.value;
      expect(birth, `${m._id}`).toBeTypeOf("number");
      expect(birth!).toBeGreaterThanOrEqual(82);
      expect(birth!).toBeLessThanOrEqual(92);
    }
    // Adjuster alone would leave ~55–57; overlay must win.
    const nw = ngStateMetrics.find((m) => m._id === "NORTH_WEST")!;
    const adj = applyEra1953Adjustments(nw);
    expect(adj.population!.birthRate!.value).toBeLessThan(60);
    const overlay = getRegionMetricPresets("NG", "NORTH_WEST", "1953-default")!;
    expect(overlay["population.birthRate"]).toBe(92);
    expect(applyMetricPresetToMetrics(adj, overlay).population!.birthRate!.value).toBe(92);
  });
});
