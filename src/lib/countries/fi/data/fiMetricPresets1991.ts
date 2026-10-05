/**
 * Finland 1991 metric overlay.
 *
 * The base `fiStateMetrics` bundle is authored on ~1979 values, so a 1991
 * world otherwise opens Finland on its 1979 growth and unemployment (#3034).
 * Only the two headline cyclical series are overlaid; the structural metrics
 * keep their base values rather than inventing regional detail. Unemployment
 * shifts every region by the national change so regional gaps survive.
 * Finland's 1991 recession: real GDP fell about 6 percent and unemployment averaged 7.6 percent (Statistics Finland national accounts and labour force survey).
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";
import { fiStateMetrics } from "./fiStateMetrics";

const BASE_NATIONAL_UNEMPLOYMENT = 6.0;
const NATIONAL_1991: Record<string, number> = {
  "economic.gdpGrowth": -6.3,
};
const UNEMPLOYMENT_1991 = 7.6;

export const fiMetricPresets1991: MetricPresetBundle = Object.fromEntries(
  fiStateMetrics.map((metric) => [
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
