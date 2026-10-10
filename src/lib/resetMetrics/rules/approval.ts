/**
 * Named approval conditions use owner-produced Metrics v2 observations.
 * Only compatible units are adapted; retired inputs never become guessed values.
 * evaluateResetApprovalModifiers retains the existing condition effects and caps.
 */
import { primaryMetrics } from "../catalog";
import type { OpeningMetricObservation } from "./openingObservation";
import { evaluateModifiers, type EvaluateModifiersOptions } from "@/lib/utils/approvalModifiers";

export function resetApprovalMetricValues(
  observations: Readonly<Record<string, OpeningMetricObservation>>
) {
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

/** Explicit v2 polarity for the shared relative scorer, including renamed inputs. */
export const resetApprovalDirections: Readonly<Record<string, boolean>> = {
  ...Object.fromEntries(
    primaryMetrics.map((metric) => [metric.path.split(".")[1], metric.interpretation === "higher"])
  ),
  uninsuredRate: false,
  airQuality: false, // The condition adapter exposes pollution burden.
  nhsWaitingTime: false,
  housingAffordability: false, // The base adapter retains the housing-burden index.
};

/** Legacy scorer input, restricted to real outcomes with an existing direction. */
export function resetApprovalBaseMetrics(
  observations: Readonly<Record<string, OpeningMetricObservation>>
) {
  const values = resetApprovalMetricValues(observations);
  // Band and demographic context readouts have no monotonic approval term.
  delete values.economic?.priceStability;
  delete values.population;
  delete values.security;
  // Each observation contributes once, even when a condition needs an alias.
  delete values.healthcare?.coverageRate;
  delete values.healthcare?.treatmentWait;
  if (values.social?.housingCostBurden != null) {
    values.social.housingAffordability = values.social.housingCostBurden;
    delete values.social.housingCostBurden;
  }
  return Object.fromEntries(
    Object.entries(values).map(([category, metrics]) => [
      category,
      Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, { value }])),
    ])
  );
}
