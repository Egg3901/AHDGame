import { describe, expect, it } from "vitest";
import {
  auditOpeningMetricSources,
  auditOpeningNationalMetricSources1991,
} from "./auditOpeningMetrics";
import { openingNationalFiscalObservations1991 } from "../../src/lib/resetMetrics/openingSeed1991";
import { states1991 } from "../../src/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "../../src/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "../../src/lib/countries/jp/data/jpRegions1991";
import { ieRegions1991 } from "../../src/lib/countries/ie/data/ieRegions1991";
import { opening1991Anchors } from "../../src/lib/resetMetrics/rules/provisionalOpening";

describe("1991 opening metric source audit", () => {
  it("keeps source observations separate from explicitly provisional opening estimates", () => {
    const rows = auditOpeningMetricSources();
    expect(rows).toHaveLength(79);
    expect(rows.filter((row) => row.country === "US")).toHaveLength(51);
    expect(rows.filter((row) => row.country === "UK")).toHaveLength(12);
    expect(rows.filter((row) => row.country === "JP")).toHaveLength(8);
    expect(rows.filter((row) => row.country === "IE")).toHaveLength(8);
    for (const row of rows) {
      expect(row.observed).toBe(row.country === "UK" || row.country === "IE" ? 46 : 45);
      expect(row.provisional).toBe(row.country === "UK" || row.country === "IE" ? 7 : 8);
      expect(row.openingValues["07"]).toBeUndefined();
      expect(row.openingValues["09"]).toBeUndefined();
      expect(row.openingValues["10"]).toBeUndefined();
      expect(row.openingValues["57"]).toBeUndefined();
      expect(row.openingValues["58"]).toBeUndefined();
      expect(row.openingValues["12"]).toBeGreaterThan(0);
      expect(row.openingValues["56"]).toBeGreaterThan(0);
      expect(row.openingValues["56"]).toBeLessThan(200);
      expect(row.openingValues["55"]).toBeGreaterThan(0);
      expect(row.openingValues["32"]).toBeGreaterThanOrEqual(0);
      expect(row.openingValues["18"]).toBeGreaterThan(0);
      expect(row.unavailable).toEqual([]);
      for (const id of ["02", "15", "16", "20", "24", "49", "54"]) {
        expect(row.openingObservations[id]).toMatchObject({ status: "proxy" });
        expect(row.openingObservations[id].source).toContain("provisional 1991 game estimate");
        expect(row.openingObservations[id].note).toContain("Opening estimate only");
      }
      expect(row.openingObservations["18"].status).toBe("proxy");
    }
  });

  it("rebases v2 fertility to the 1991 country anchors without changing v1 seeds", () => {
    const rows = auditOpeningMetricSources();
    const regions = { US: states1991, UK: ukRegions1991, JP: jpRegions1991, IE: ieRegions1991 };
    const targets = { US: 2.07, UK: 1.82, JP: 1.53, IE: 2.09 };
    for (const country of ["US", "UK", "JP", "IE"] as const) {
      const populationByRegion = new Map(
        regions[country].map((region) => [region._id, region.population])
      );
      const countryRows = rows.filter((row) => row.country === country);
      const population = countryRows.reduce(
        (sum, row) => sum + (populationByRegion.get(row.regionId) ?? 0),
        0
      );
      const mean =
        countryRows.reduce(
          (sum, row) =>
            sum + (populationByRegion.get(row.regionId) ?? 0) * (row.openingValues["55"] ?? 0),
          0
        ) / population;
      expect(mean).toBeCloseTo(targets[country], 9);
    }
  });

  it("preserves national 1991 life and population-change anchors across regional proxies", () => {
    const rows = auditOpeningMetricSources();
    const regions = { US: states1991, UK: ukRegions1991, JP: jpRegions1991, IE: ieRegions1991 };
    for (const country of ["US", "UK", "JP", "IE"] as const) {
      const weights = new Map(regions[country].map((region) => [region._id, region.population]));
      const countryRows = rows.filter((row) => row.country === country);
      const total = countryRows.reduce((sum, row) => sum + (weights.get(row.regionId) ?? 0), 0);
      for (const [id, anchor] of [
        ["20", opening1991Anchors[country].lifeYears],
        ["54", opening1991Anchors[country].growthPercent],
      ] as const) {
        const mean =
          countryRows.reduce(
            (sum, row) => sum + (weights.get(row.regionId) ?? 0) * (row.openingValues[id] ?? 0),
            0
          ) / total;
        expect(mean).toBeCloseTo(anchor, 9);
      }
      if (country === "JP") {
        expect(new Set(countryRows.map((row) => row.openingValues["20"])).size).toBeGreaterThan(1);
      }
    }
  });

  it("keeps provisional 1991 metric ranges finite and within broad game guardrails", () => {
    const bounds: Record<string, [number, number]> = {
      "15": [20, 220],
      "16": [60, 100],
      "18": [1, 80],
      "20": [65, 85],
      "24": [50, 160],
      "49": [0, 100],
      "54": [-3, 4],
    };
    const purchasingPowerBounds: Record<"US" | "UK" | "JP" | "IE", [number, number]> = {
      US: [1_000, 500_000],
      UK: [1_000, 500_000],
      JP: [100_000, 100_000_000],
      IE: [1_000, 500_000],
    };
    for (const row of auditOpeningMetricSources()) {
      const purchasingPower = row.openingValues["02"];
      const [purchasingPowerMinimum, purchasingPowerMaximum] = purchasingPowerBounds[row.country];
      expect(purchasingPower, `${row.country}/${row.regionId}/02`).not.toBeNull();
      expect(purchasingPower!, `${row.country}/${row.regionId}/02`).toBeGreaterThanOrEqual(
        purchasingPowerMinimum
      );
      expect(purchasingPower!, `${row.country}/${row.regionId}/02`).toBeLessThanOrEqual(
        purchasingPowerMaximum
      );
      for (const [id, [minimum, maximum]] of Object.entries(bounds)) {
        const value = row.openingValues[id];
        expect(value, `${row.country}/${row.regionId}/${id}`).not.toBeNull();
        expect(value!, `${row.country}/${row.regionId}/${id}`).toBeGreaterThanOrEqual(minimum);
        expect(value!, `${row.country}/${row.regionId}/${id}`).toBeLessThanOrEqual(maximum);
      }
    }
  });

  it("keeps fiscal balance and debt as national ledger-owned observations", () => {
    const national = openingNationalFiscalObservations1991();
    expect(national.US.balance.value).toBeCloseTo(-0.5, 2);
    expect(national.US.debt.value).toBeCloseTo(59.113, 2);
    expect(national.UK.balance.value).toBeCloseTo(-0.5, 2);
    expect(national.UK.debt.value).toBeCloseTo(32.353, 3);
    expect(national.JP.balance.value).toBeCloseTo(0.6115, 3);
    expect(national.JP.debt.value).toBeCloseTo(36.596, 2);
    expect(national.IE.balance.value).toBeCloseTo(-0.5, 2);
    expect(national.IE.debt.value).toBeCloseTo(91.666, 2);
    for (const country of ["US", "UK", "JP", "IE"] as const) {
      expect(national[country].balance.owner).toBe("ledger");
      expect(national[country].debt.owner).toBe("ledger");
    }
  });

  it("reports all five national metrics separately and marks fuel risk as provisional", () => {
    const national = auditOpeningNationalMetricSources1991();
    for (const country of ["US", "UK", "JP", "IE"] as const) {
      expect(Object.keys(national[country]).sort()).toEqual(["07", "09", "10", "57", "58"]);
      expect(national[country]["07"]?.value).not.toBeNull();
      expect(national[country]["09"]?.value).not.toBeNull();
      expect(national[country]["10"]?.value).not.toBeNull();
      expect(national[country]["57"]?.value).toBeGreaterThan(0);
      expect(national[country]["57"]?.value).toBeLessThanOrEqual(100);
      expect(national[country]["58"]).toMatchObject({ status: "proxy", owner: "energy" });
      expect(national[country]["58"]?.value).toBeGreaterThanOrEqual(0);
      expect(national[country]["58"]?.value).toBeLessThanOrEqual(100);
      expect(national[country]["58"]?.note).toContain("not a verified 1991 physical fuel ledger");
    }
  });
});
