/**
 * Re-export from src/lib/constants/metricDefinitions.ts
 *
 * This file exists for backwards compatibility with scripts that import
 * from "./seeds/metricDefinitions". New code should import from
 * "@/lib/constants/metricDefinitions" instead.
 */
export {
  metricCategories,
  getMetricsForCountry,
  getMetricDefinition,
  getMetricCategory,
  formatMetricValue,
  type MetricDefinition,
  type MetricCategory,
} from "../../src/lib/constants/metricDefinitions";
