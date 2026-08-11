/**
 * IE/JP 1953 life-expectancy overlays — the above-floor gap class.
 *
 * Ireland never runs applyEra1953Adjustments, so without an authored overlay it
 * keeps modern ieStateMetrics (~82). Japan does run the adjuster, but
 * clamp(83−11, 40, 72) lands on the era-band ceiling (72) — still far above the
 * real early-1950s Japanese figure (~63). Both need MetricPresets1953 overlays.
 *
 * Also guards the world-wide authored 1953 spread: China/Turkey floors (~40)
 * must stay well below 60 so a future Western-band narrowing fails loudly.
 */
import { describe, expect, it } from "vitest";
import { applyMetricPresetToMetrics, getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { applyEra1953Adjustments } from "@/lib/seeds/reference/stateMetricsEra1953";
import { ieStateMetrics } from "@/lib/seeds/ie/ieStateMetrics";
import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";
import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";

/** Defensible national bands around UN Demographic Yearbook 1950-55 e0. */
const LIFE_BANDS: Record<
  "IE" | "JP",
  { lo: number; hi: number; sampleRegion: string; national: number }
> = {
  IE: { lo: 64, hi: 68, sampleRegion: "DUB", national: 66 }, // CSO / UN DYB ≈65–67
  JP: { lo: 60, hi: 66, sampleRegion: "KAN", national: 63 }, // Stats Bureau / UN DYB ≈61–64
};

const IE_REGIONS = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"] as const;
const JP_REGIONS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"] as const;

/** Every country registered with a 1953 metric-preset bundle. */
const BUNDLE_1953_COUNTRIES: CountryId[] = [
  "IE",
  "DE",
  "JP",
  "BR",
  "CN",
  "NG",
  "IT",
  "UK",
  "US",
  "RU",
  "FR",
  "ES",
  "SE",
  "TR",
  "AT",
  "FI",
  "GR",
];

function resolveIe1953(metrics: StateMetrics[]): StateMetrics[] {
  // seedIE never runs the 1953 adjuster — overlay alone must win.
  return metrics.map((m) => {
    const overlay = getRegionMetricPresets("IE", String(m._id), "1953-default");
    return overlay ? applyMetricPresetToMetrics(m, overlay) : structuredClone(m);
  });
}

function resolveJp1953(metrics: StateMetrics[]): StateMetrics[] {
  return metrics.map((m) => {
    let next = applyEra1953Adjustments(m);
    const overlay = getRegionMetricPresets("JP", String(m._id), "1953-default");
    if (overlay) next = applyMetricPresetToMetrics(next, overlay);
    return next;
  });
}

describe("1953 life-expectancy overlays — IE / JP", () => {
  it("IE: every region overlay authors lifeExpectancy inside [64, 68]", () => {
    for (const regionId of IE_REGIONS) {
      const overlay = getRegionMetricPresets("IE", regionId, "1953-default");
      expect(overlay, `IE/${regionId}`).toBeTruthy();
      const life = overlay!["healthcare.lifeExpectancy"];
      expect(life, `IE/${regionId}`).toBeTypeOf("number");
      expect(life).toBeGreaterThanOrEqual(LIFE_BANDS.IE.lo);
      expect(life).toBeLessThanOrEqual(LIFE_BANDS.IE.hi);
    }
  });

  it("JP: every region overlay authors lifeExpectancy inside [60, 66]", () => {
    for (const regionId of JP_REGIONS) {
      const overlay = getRegionMetricPresets("JP", regionId, "1953-default");
      expect(overlay, `JP/${regionId}`).toBeTruthy();
      const life = overlay!["healthcare.lifeExpectancy"];
      expect(life, `JP/${regionId}`).toBeTypeOf("number");
      expect(life).toBeGreaterThanOrEqual(LIFE_BANDS.JP.lo);
      expect(life).toBeLessThanOrEqual(LIFE_BANDS.JP.hi);
    }
  });

  it("IE resolves ~66 after overlay (not modern ~82)", () => {
    const dub = ieStateMetrics.find((m) => m._id === "DUB")!;
    expect(dub.healthcare!.lifeExpectancy!.value).toBeGreaterThan(80);
    const resolved = resolveIe1953(ieStateMetrics);
    for (const m of resolved) {
      const life = m.healthcare?.lifeExpectancy?.value;
      expect(life, `IE/${m._id}`).toBeTypeOf("number");
      expect(life!).toBeGreaterThanOrEqual(LIFE_BANDS.IE.lo);
      expect(life!).toBeLessThanOrEqual(LIFE_BANDS.IE.hi);
    }
    const dubFinal = resolved.find((m) => m._id === "DUB")!;
    expect(dubFinal.healthcare!.lifeExpectancy!.value).toBe(67);
  });

  it("JP resolves ~63 after adjuster-then-overlay (not adjuster ceiling 72)", () => {
    const kan = jpStateMetrics.find((m) => m._id === "KAN")!;
    expect(kan.healthcare!.lifeExpectancy!.value).toBeGreaterThan(80);
    const adjOnly = applyEra1953Adjustments(kan);
    // Without overlay the adjuster pins Japan to the era-band ceiling.
    expect(adjOnly.healthcare!.lifeExpectancy!.value).toBe(72);

    const resolved = resolveJp1953(jpStateMetrics);
    for (const m of resolved) {
      const life = m.healthcare?.lifeExpectancy?.value;
      expect(life, `JP/${m._id}`).toBeTypeOf("number");
      expect(life!).toBeGreaterThanOrEqual(LIFE_BANDS.JP.lo);
      expect(life!).toBeLessThanOrEqual(LIFE_BANDS.JP.hi);
    }
    const kanFinal = resolved.find((m) => m._id === "KAN")!;
    expect(kanFinal.healthcare!.lifeExpectancy!.value).toBe(65);
  });

  it("urban regions sit above rural ones (modest health gradient)", () => {
    expect(
      getRegionMetricPresets("IE", "DUB", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBeGreaterThan(
      getRegionMetricPresets("IE", "DON", "1953-default")!["healthcare.lifeExpectancy"]
    );
    expect(
      getRegionMetricPresets("JP", "KAN", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBeGreaterThan(
      getRegionMetricPresets("JP", "TOH", "1953-default")!["healthcare.lifeExpectancy"]
    );
  });
});

describe("1953 life-expectancy overlays — world-wide authored spread", () => {
  it("minimum authored healthcare.lifeExpectancy across 1953 bundles is well below 60", () => {
    const authored: number[] = [];
    // Sample capitals / first known region per country that has an overlay entry.
    const sampleRegions: Partial<Record<CountryId, string>> = {
      IE: "DUB",
      JP: "KAN",
      DE: "NW",
      BR: "SUDESTE",
      CN: "HD",
      NG: "SOUTH_WEST",
      IT: "IT_NW",
      UK: "LON",
      US: "CA",
      RU: "CEN",
      FR: "FR_IDF",
      ES: "ES_MAD",
      SE: "SE_STH",
      TR: "TR_IST",
      AT: "AT_VIE",
      FI: "FI_UUS",
      GR: "GR_ATT",
    };

    for (const cc of BUNDLE_1953_COUNTRIES) {
      const regionId = sampleRegions[cc];
      if (!regionId) continue;
      const overlay = getRegionMetricPresets(cc, regionId, "1953-default");
      if (!overlay) continue;
      const life = overlay["healthcare.lifeExpectancy"];
      if (typeof life === "number") authored.push(life);
    }

    // Walk every CN + TR region (the low end) so a capital-only sample cannot hide a raise.
    for (const regionId of ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"]) {
      const o = getRegionMetricPresets("CN", regionId, "1953-default");
      if (o && typeof o["healthcare.lifeExpectancy"] === "number") {
        authored.push(o["healthcare.lifeExpectancy"]);
      }
    }
    for (const regionId of [
      "TR_IST",
      "TR_ANK",
      "TR_IZM",
      "TR_MED",
      "TR_BLA",
      "TR_ESA",
      "TR_SEA",
      "TR_CEN",
    ]) {
      const o = getRegionMetricPresets("TR", regionId, "1953-default");
      if (o && typeof o["healthcare.lifeExpectancy"] === "number") {
        authored.push(o["healthcare.lifeExpectancy"]);
      }
    }

    expect(authored.length).toBeGreaterThan(10);
    const min = Math.min(...authored);
    expect(min).toBeLessThan(60);
    // Ceiling check: Sweden remains the high end of the authored world.
    expect(Math.max(...authored)).toBeLessThanOrEqual(72);
  });
});
