/** Five-year sensitivity for the provisional v2 provider-access owner. */
import { liveHealthProxies } from "@/lib/resetMetrics/rules/liveHealthProxies";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

export interface HealthProxySimulationSummary {
  countryId: "US" | "UK" | "JP";
  scenario: "unchanged" | "capacity_expansion" | "provider_shock";
  initialCoverage: number;
  finalCoverage: number;
  initialDelay: number;
  finalDelay: number;
  lowestCoverage: number;
  highestDelay: number;
}

const opening = {
  US: { physicianRate: 300, preparedness: 60, uninsuredPercent: 14 },
  UK: { physicianRate: 300, preparedness: 60, uninsuredPercent: null },
  JP: { physicianRate: 300, preparedness: 60, uninsuredPercent: null },
} as const;

export function simulateResetHealthProxy240(): HealthProxySimulationSummary[] {
  const summaries: HealthProxySimulationSummary[] = [];
  for (const countryId of ["US", "UK", "JP"] as const) {
    for (const scenario of ["unchanged", "capacity_expansion", "provider_shock"] as const) {
      const readings = Array.from({ length: 241 }, (_, turn) => {
        const expanded = scenario === "capacity_expansion";
        const shock = scenario === "provider_shock" && turn >= 120 && turn < 168;
        const physicianRate =
          opening[countryId].physicianRate * (expanded ? 1 + 0.0015 * turn : shock ? 0.5 : 1);
        const preparedness =
          opening[countryId].preparedness * (expanded ? 1 + 0.001 * turn : shock ? 0.5 : 1);
        const uninsuredPercent =
          countryId === COUNTRY_CONFIGS.US.id
            ? expanded
              ? Math.max(0, 14 - 0.01 * turn)
              : 14
            : null;
        const result = liveHealthProxies({
          countryId,
          uninsuredPercent,
          physicianRate,
          preparedness,
          openingPhysicianReference: opening[countryId].physicianRate,
          openingPreparednessReference: opening[countryId].preparedness,
        });
        if (!result) throw new Error(`Missing health proxy at ${countryId}/${scenario}/${turn}`);
        return result;
      });
      summaries.push({
        countryId,
        scenario,
        initialCoverage: readings[0]!.effectiveCoverage,
        finalCoverage: readings[240]!.effectiveCoverage,
        initialDelay: readings[0]!.treatmentDelayIndex,
        finalDelay: readings[240]!.treatmentDelayIndex,
        lowestCoverage: Math.min(...readings.map((reading) => reading.effectiveCoverage)),
        highestDelay: Math.max(...readings.map((reading) => reading.treatmentDelayIndex)),
      });
    }
  }
  return summaries;
}

if (process.argv[1]?.endsWith("resetHealthProxy240.ts")) {
  console.table(simulateResetHealthProxy240());
}
