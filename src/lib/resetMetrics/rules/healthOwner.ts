/** Health inputs expressed in legacy units from the current regional performance board. */
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { politicalValueForLegacyMetric } from "@/lib/politicalLegislation/marginAdapter";
import { legacyValueFromPoliticalScore } from "@/lib/politicalMetrics/derive/legacyInversion";

export function healthOwnerInputs(
  values: Record<PoliticalMetricId, number>,
  countryId: string,
  year?: number
) {
  const read = (metricId: string): number | null => {
    const score = politicalValueForLegacyMetric(values, "healthcare", metricId);
    return score === null
      ? null
      : legacyValueFromPoliticalScore("healthcare", metricId, score, { countryId, year });
  };
  return {
    physicianRate: read("physicianRate"),
    preparedness: read("publicHealthPreparedness"),
    uninsuredPercent: read("uninsuredRate"),
    waitingTime: read(countryId === "IE" ? "hseWaitingListMonths" : "nhsWaitingTime"),
  };
}
