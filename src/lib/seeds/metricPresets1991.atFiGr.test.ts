/**
 * AT/FI/GR 1991 metric overlay (#3034): a 1991 world must not open Finland on
 * its 1979 growth spike, and regional unemployment gaps must survive the shift.
 */
import { describe, expect, it } from "vitest";
import { getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { atStateMetrics } from "@/lib/countries/at/data/atStateMetrics";
import { fiStateMetrics } from "@/lib/countries/fi/data/fiStateMetrics";
import { grStateMetrics } from "@/lib/countries/gr/data/grStateMetrics";
import type { CountryId } from "@/lib/constants/countries";

const CASES: Array<{
  country: CountryId;
  metrics: Array<{ _id: unknown; economic: { unemploymentRate: { value: number } } }>;
  growth: number;
  unemployment: number;
}> = [
  { country: "AT", metrics: atStateMetrics, growth: 3.3, unemployment: 5.8 },
  { country: "FI", metrics: fiStateMetrics, growth: -6.3, unemployment: 7.6 },
  { country: "GR", metrics: grStateMetrics, growth: 3.1, unemployment: 7.0 },
];

describe("AT/FI/GR 1991 metric presets", () => {
  for (const { country, metrics, growth, unemployment } of CASES) {
    it(`${country}: every region resolves the 1991 growth and a shifted unemployment`, () => {
      let sum = 0;
      for (const m of metrics) {
        const overlay = getRegionMetricPresets(country, String(m._id), "1991-default");
        expect(overlay, `${country}/${String(m._id)}`).toBeTruthy();
        expect(overlay!["economic.gdpGrowth"]).toBe(growth);
        sum += overlay!["economic.unemploymentRate"]! - m.economic.unemploymentRate.value;
      }
      // The same national change in every region, so regional gaps are kept.
      const mean = sum / metrics.length;
      expect(mean).toBeGreaterThan(0);
      for (const m of metrics) {
        const overlay = getRegionMetricPresets(country, String(m._id), "1991-default")!;
        const delta = overlay["economic.unemploymentRate"]! - m.economic.unemploymentRate.value;
        expect(Math.abs(delta - mean)).toBeLessThan(0.11);
      }
      expect(unemployment).toBeGreaterThan(0);
    });
  }

  it("leaves other presets untouched", () => {
    expect(getRegionMetricPresets("FI", String(fiStateMetrics[0]._id), "1979-default")).toBeNull();
  });
});
