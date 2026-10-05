/**
 * Austria 1991 metric overlay.
 *
 * The base `atStateMetrics` bundle is authored on ~1979 values, so a 1991
 * world otherwise opens Austria on its 1979 growth and unemployment (#3034).
 * Only the two headline cyclical series are overlaid; the structural metrics
 * keep their base values rather than inventing regional detail. Unemployment
 * shifts every region by the national change so regional gaps survive.
 * Austria in 1991: real GDP grew about 3.3 percent and registered unemployment averaged 5.8 percent (WIFO, Austrian Labour Market Service).
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";
import { atStateMetrics } from "./atStateMetrics";

const BASE_NATIONAL_UNEMPLOYMENT = 2.1;
const NATIONAL_1991: Record<string, number> = {
  "economic.gdpGrowth": 3.3,
};
const UNEMPLOYMENT_1991 = 5.8;

export const atMetricPresets1991: MetricPresetBundle = Object.fromEntries(
  atStateMetrics.map((metric) => [
    String(metric._id),
    {
      ...NATIONAL_1991,
      "economic.unemploymentRate": Number(
        Math.max(
          0,
          metric.economic.unemploymentRate.value + UNEMPLOYMENT_1991 - BASE_NATIONAL_UNEMPLOYMENT
        ).toFixed(1)
      ),
    },
  ])
);
