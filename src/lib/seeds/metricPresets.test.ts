import { describe, expect, it } from "vitest";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";

describe("getRegionMetricPresets", () => {
  it("returns the 1991 bundle for a known IE region under the 1991 preset", () => {
    const p = getRegionMetricPresets("IE", "DUB", "1991-default");
    expect(p).toBeTruthy();
    expect(p!["governance.debtToGdp"]).toBe(95);
  });

  it("returns the 1991 bundle for a known DE Land under the 1991 preset", () => {
    const p = getRegionMetricPresets("DE", "SN", "1991-default");
    expect(p).toBeTruthy();
    expect(p!["governance.coDeterminationQuality"]).toBe(55); // East 1991 transitioning
  });

  it("returns the 1991 bundle for a known JP region under the 1991 preset", () => {
    const p = getRegionMetricPresets("JP", "KAN", "1991-default");
    expect(p).toBeTruthy();
    expect(p!["economic.propertyValueIndex"]).toBe(280); // Tokyo bubble peak
  });

  it("returns the 1991 bundle for a known BR region under the 1991 preset", () => {
    const p = getRegionMetricPresets("BR", "SUDESTE", "1991-default");
    expect(p).toBeTruthy();
    expect(p!["economic.productivityGrowth"]).toBe(-1.0); // Collor recession
  });

  it("returns the 1991 bundle for a known CN region under the 1991 preset", () => {
    const p = getRegionMetricPresets("CN", "HD", "1991-default");
    expect(p).toBeTruthy();
    expect(p!["economic.propertyValueIndex"]).toBe(45); // pre-private-market housing
  });

  it("returns the 1991 bundle for a known UK region under the 1991 preset", () => {
    const p = getRegionMetricPresets("UK", "LON", "1991-default");
    expect(p).toBeTruthy();
    expect(p!["governance.debtToGdp"]).toBe(30); // pre-90s debt build-up
  });

  it("returns the 1991 bundle for a known US state under the 1991 preset", () => {
    const p = getRegionMetricPresets("US", "CA", "1991-default");
    expect(p).toBeTruthy();
    expect(p!["governance.militaryReadiness"]).toBe(85); // Cold-War peak
  });

  it("falls back to the 2019 bundle when the preset is absent", () => {
    const p = getRegionMetricPresets("IE", "DUB", "some-unknown-preset");
    expect(p).toBeTruthy();
  });

  it("returns null for an unknown country or region", () => {
    expect(getRegionMetricPresets("ZZ" as never, "DUB", "2019-default")).toBeNull();
    expect(getRegionMetricPresets("IE", "NOPE", "2019-default")).toBeNull();
  });

  it("returns the 1953 overlay for FR/ES/SE/TR capitals", () => {
    expect(
      getRegionMetricPresets("FR", "FR_IDF", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBe(68);
    expect(
      getRegionMetricPresets("ES", "ES_MAD", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBe(64);
    expect(
      getRegionMetricPresets("SE", "SE_STH", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBe(72);
    expect(
      getRegionMetricPresets("TR", "TR_IST", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBe(48);
  });

  it("returns the 1953 overlay for AT/FI/GR capitals", () => {
    expect(
      getRegionMetricPresets("AT", "AT_VIE", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBe(68);
    expect(
      getRegionMetricPresets("FI", "FI_UUS", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBe(68);
    expect(
      getRegionMetricPresets("GR", "GR_ATT", "1953-default")!["healthcare.lifeExpectancy"]
    ).toBe(66);
  });
});
