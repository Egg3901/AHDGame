/**
 * Named approval conditions use owner-produced Metrics v2 observations.
 * Only compatible units are adapted; retired inputs never become guessed values.
 * evaluateResetApprovalModifiers retains the existing condition effects and caps.
 */
import { primaryMetrics } from "../catalog";
import type { OpeningMetricObservation } from "./openingObservation";
import { evaluateModifiers, type EvaluateModifiersOptions } from "@/lib/utils/approvalModifiers";

function observedMetricValues(observations: Readonly<Record<string, OpeningMetricObservation>>) {
  const metrics: Record<string, Record<string, number>> = {};
  for (const metric of primaryMetrics) {
    const observation = observations[metric.id];
    if (
      !observation ||
      observation.path !== metric.path ||
      observation.status === "unavailable" ||
      observation.value == null ||
      !Number.isFinite(observation.value)
    )
      continue;
    const [category, key] = metric.path.split(".");
    (metrics[category] ??= {})[key] = observation.value;
  }
  return metrics;
}

export function resetApprovalMetricValues(
  observations: Readonly<Record<string, OpeningMetricObservation>>
) {
  const metrics = observedMetricValues(observations);
  // Coverage and air quality changed polarity in v2, but retain a 0-100 scale.
  const coverage = metrics.healthcare?.coverageRate;
  if (coverage != null) metrics.healthcare.uninsuredRate = 100 - coverage;
  const air = metrics.environment?.airQuality;
  if (air != null) metrics.environment.airQuality = 100 - air;
  // Treatment wait retains its treatment-delay index, rather than days.
  const wait = metrics.healthcare?.treatmentWait;
  if (wait != null) metrics.healthcare.nhsWaitingTime = wait;
  return metrics;
}

export function evaluateResetApprovalModifiers(
  observations: Readonly<Record<string, OpeningMetricObservation>>,
  context: EvaluateModifiersOptions
) {
  return evaluateModifiers(resetApprovalMetricValues(observations), {
    ...context,
    metricVersion: "v2",
  });
}

/** Only monotonic catalog outcomes contribute directly to the relative base. */
export const resetApprovalDirections: Readonly<Record<string, boolean>> = Object.fromEntries(
  primaryMetrics
    .filter((metric) => metric.interpretation === "higher" || metric.interpretation === "lower")
    .map((metric) => [metric.path.split(".")[1], metric.interpretation === "higher"])
);

/** Keep owner units and polarity; legacy condition aliases never enter the base. */
export function resetApprovalBaseMetrics(
  observations: Readonly<Record<string, OpeningMetricObservation>>
) {
  const values = observedMetricValues(observations);
  for (const metric of primaryMetrics) {
    if (metric.interpretation !== "higher" && metric.interpretation !== "lower") {
      const [category, key] = metric.path.split(".");
      delete values[category]?.[key];
    }
  }
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, metrics]) => Object.keys(metrics).length > 0)
      .map(([category, metrics]) => [
        category,
        Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, { value }])),
      ])
  );
}
