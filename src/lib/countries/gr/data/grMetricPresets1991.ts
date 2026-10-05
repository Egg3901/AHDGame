/**
 * Greece 1991 metric overlay.
 *
 * The base `grStateMetrics` bundle is authored on ~1979 values, so a 1991
 * world otherwise opens Greece on its 1979 growth and unemployment (#3034).
 * Only the two headline cyclical series are overlaid; the structural metrics
 * keep their base values rather than inventing regional detail. Unemployment
 * shifts every region by the national change so regional gaps survive.
 * Greece in 1991: real GDP grew roughly 3 percent and standardized unemployment was about 7 percent (OECD Economic Outlook).
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";
import { grStateMetrics } from "./grStateMetrics";

const BASE_NATIONAL_UNEMPLOYMENT = 3.9;
const NATIONAL_1991: Record<string, number> = {
  "economic.gdpGrowth": 3.1,
};
const UNEMPLOYMENT_1991 = 7.0;

export const grMetricPresets1991: MetricPresetBundle = Object.fromEntries(
  grStateMetrics.map((metric) => [
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
