/**
 * Reset metric opening observations. Missing source stocks remain unavailable
 * instead of becoming zero or a permanent legislative bonus. Every value is
 * tagged with its derivation and only its designated owner may replace it.
 */
import { primaryMetricById, type PrimaryMetricDefinition } from "../catalog";

export type ObservationStatus = "observed" | "derived" | "proxy" | "unavailable";

export interface OpeningMetricObservation {
  metricId: string;
  path: string;
  value: number | null;
  status: ObservationStatus;
  source: string;
  owner: string;
  note: string;
}

export interface OpeningMetricInputs {
  /** Era-adjusted regional legacy value at the metric's existing path. */
  legacyValue?: number | null;
  /** Recomputed by the named fiscal, cohort, or perception owner. */
  ownerValue?: number | null;
  afterTaxMedianResources?: number | null;
  /** Consumer-price index where 100 represents the constant-price base. */
  consumerBasketIndex?: number | null;
  annualCpiChange?: number | null;
  cpiVolatility48?: number | null;
  testedCohortScore?: number | null;
  testedCohortReference?: number | null;
  researcherCapacity?: number | null;
  laboratoryCapacity?: number | null;
  researchQuality?: number | null;
  /** Comparable, population-weighted country research-capacity stock. */
  researchCompositeReference?: number | null;
  uninsuredPercent?: number | null;
  reachableServicePercent?: number | null;
  legacyTreatmentDelayIndex?: number | null;
  housingPaymentToIncome?: number | null;
  /** Population-weighted 1991 country housing-payment burden. */
  housingBurdenReference?: number | null;
  totalCrimeRate?: number | null;
  violentCrimeRate?: number | null;
  offenseUniverseReconciled?: boolean;
  populationUnder15?: number | null;
  population15To64?: number | null;
  population65Plus?: number | null;
  /** Owned risk-band derivation from a physical import/reserve fuel ledger. */
  energyRiskBand?: number | null;
  physicalFuelLedgerVerified?: boolean;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function observation(
  metric: PrimaryMetricDefinition,
  value: number | null,
  status: ObservationStatus,
  source: string,
  note: string
): OpeningMetricObservation {
  return {
    metricId: metric.id,
    path: metric.path,
    value,
    status,
    source,
    owner: metric.owner,
    note,
  };
}

function unavailable(metric: PrimaryMetricDefinition, reason: string): OpeningMetricObservation {
  return observation(metric, null, "unavailable", "none", reason);
}

function positive(value: number | null | undefined): value is number {
  return finite(value) && value > 0;
}

/** A fresh-world seed must reject an unavailable metric before enabling its v2 writer. */
export function buildOpeningMetricObservation(
  metricId: string,
  input: OpeningMetricInputs
): OpeningMetricObservation {
  const metric = primaryMetricById(metricId);
  if (!metric) throw new Error(`unknown reset metric ${metricId}`);
  if (metric.openingSource === "carry") {
    return finite(input.legacyValue)
      ? observation(
          metric,
          input.legacyValue,
          "observed",
          "era-adjusted legacy metric",
          "Opening observation only; the named owner writes future values."
        )
      : unavailable(metric, "Era-adjusted 1991 observation is missing.");
  }
  if (metric.openingSource === "recompute") {
    return finite(input.ownerValue)
      ? observation(
          metric,
          input.ownerValue,
          "derived",
          metric.owner,
          "Recomputed by its designated owner, not copied from a legacy field."
        )
      : unavailable(metric, `${metric.owner} has not produced an opening observation.`);
  }
  switch (metricId) {
    case "02":
      return positive(input.afterTaxMedianResources) && positive(input.consumerBasketIndex)
        ? observation(
            metric,
            (input.afterTaxMedianResources * 100) / input.consumerBasketIndex,
            "derived",
            "household disposable resources and consumer basket",
            "Annual real household income in local currency at constant 1991 prices."
          )
        : unavailable(metric, "After-tax median resources or consumer-price index is missing.");
    case "07":
      return finite(input.annualCpiChange) && finite(input.cpiVolatility48)
        ? observation(
            metric,
            input.annualCpiChange,
            "derived",
            "CPI process and 48-turn volatility",
            `Annual CPI change; opening volatility ${input.cpiVolatility48}. This is not a 0-100 score.`
          )
        : unavailable(metric, "CPI change and an explicit volatility window are required.");
    case "12":
      return positive(input.testedCohortScore) && positive(input.testedCohortReference)
        ? observation(
            metric,
            (input.testedCohortScore / input.testedCohortReference) * 100,
            "derived",
            "era-adjusted tested cohort and population-weighted country reference",
            "1991 regional cohort index relative to the country's population-weighted mean; GCSE remains a UK drill-down."
          )
        : unavailable(metric, "A comparable tested cohort score or country reference is missing.");
    case "15":
      return positive(input.researcherCapacity) &&
        positive(input.laboratoryCapacity) &&
        positive(input.researchQuality) &&
        positive(input.researchCompositeReference)
        ? observation(
            metric,
            ((input.researcherCapacity * input.laboratoryCapacity * input.researchQuality) /
              input.researchCompositeReference) *
              100,
            "derived",
            "research staff, labs, and output quality",
            "1991 capacity relative to the country's population-weighted opening composite; spending alone is not the score."
          )
        : unavailable(metric, "Research staff, labs, quality, or country reference is missing.");
    case "16":
      return finite(input.uninsuredPercent) &&
        finite(input.reachableServicePercent) &&
        input.uninsuredPercent >= 0 &&
        input.uninsuredPercent <= 100 &&
        input.reachableServicePercent >= 0 &&
        input.reachableServicePercent <= 100
        ? observation(
            metric,
            Math.min(100 - input.uninsuredPercent, input.reachableServicePercent),
            "derived",
            "enrollment and reachable service slots",
            "Coverage is capped by reachable care, not enrollment alone."
          )
        : unavailable(metric, "Enrollment and verified reachable-care capacity are required.");
    case "18":
      return finite(input.legacyTreatmentDelayIndex)
        ? observation(
            metric,
            input.legacyTreatmentDelayIndex,
            "proxy",
            "era-adjusted legacy waiting index",
            "Comparable delay proxy, not days; the UK NHS label is a drill-down."
          )
        : unavailable(metric, "A comparable 1991 treatment-delay proxy is missing.");
    case "24":
      return positive(input.housingPaymentToIncome) && positive(input.housingBurdenReference)
        ? observation(
            metric,
            (input.housingPaymentToIncome / input.housingBurdenReference) * 100,
            "derived",
            "housing payment-to-disposable-income distribution",
            "1991 burden relative to the country's population-weighted opening burden; renter and owner detail is retained."
          )
        : unavailable(
            metric,
            "Housing payments, disposable income, or country reference is missing."
          );
    case "32":
      return input.offenseUniverseReconciled &&
        finite(input.totalCrimeRate) &&
        finite(input.violentCrimeRate) &&
        input.totalCrimeRate >= input.violentCrimeRate &&
        input.violentCrimeRate >= 0
        ? observation(
            metric,
            input.totalCrimeRate - input.violentCrimeRate,
            "derived",
            "matched offense universe",
            "Total minus violent offenses, only after denominator and reporting reconciliation."
          )
        : unavailable(metric, "Crime and violent-crime denominators have not been reconciled.");
    case "56":
      return finite(input.populationUnder15) &&
        positive(input.population15To64) &&
        finite(input.population65Plus) &&
        input.populationUnder15 >= 0 &&
        input.population65Plus >= 0
        ? observation(
            metric,
            ((input.populationUnder15 + input.population65Plus) / input.population15To64) * 100,
            "derived",
            "seeded age cohorts",
            "Dependents per 100 people aged 15-64; a contextual burden, not a moral score."
          )
        : unavailable(metric, "Seeded child, working-age, or elder cohorts are missing.");
    case "58":
      return input.physicalFuelLedgerVerified && finite(input.energyRiskBand)
        ? observation(
            metric,
            input.energyRiskBand,
            "derived",
            "verified fuel import, reserve and source ledger",
            "Contextual disruption risk; grid reliability is a separate measure."
          )
        : unavailable(metric, "A verified physical fuel-balance ledger is required.");
    default:
      return unavailable(metric, "No approved 1991 derivation is defined for this metric.");
  }
}
