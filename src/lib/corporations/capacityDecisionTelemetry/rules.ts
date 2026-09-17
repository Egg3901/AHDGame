/** Pure, privacy-safe contract for aggregate capacity-decision telemetry. */

export const CAPACITY_DECISION_SCHEMA_VERSION = 1 as const;

export type CapacityDecisionActor = "player" | "npp";
export type CapacityDecisionStage = "quote" | "order";
export type CapacityDecisionOutcome =
  "quoted" | "placed" | "queue_full" | "insufficient_cash" | "concurrent_change";

export interface CapacityDecisionObservation {
  actor: CapacityDecisionActor;
  stage: CapacityDecisionStage;
  outcome: CapacityDecisionOutcome;
  marketSharePct: number;
  competitorCount: number;
  rawDominanceMultiplier: number;
  dominanceDensityFactor: number;
  dominanceMultiplier: number;
  unitPriceAnchor: number;
  cashHeadroomAnchor: number;
  requestedUnits: number;
}

export interface CapacityDecisionAggregate {
  observations: number;
  marketSharePctSum: number;
  competitorCountSum: number;
  rawDominanceMultiplierSum: number;
  dominanceDensityFactorSum: number;
  dominanceMultiplierSum: number;
  unitPriceAnchorSum: number;
  cashHeadroomAnchorSum: number;
  requestedUnitsSum: number;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function capacityDecisionBucketKey(
  observation: Pick<CapacityDecisionObservation, "actor" | "stage" | "outcome">
): string {
  return `${observation.actor}:${observation.stage}:${observation.outcome}`;
}

export function aggregateCapacityDecisions(
  observations: readonly CapacityDecisionObservation[]
): Record<string, CapacityDecisionAggregate> {
  const result: Record<string, CapacityDecisionAggregate> = {};
  for (const observation of observations) {
    const key = capacityDecisionBucketKey(observation);
    const bucket = (result[key] ??= {
      observations: 0,
      marketSharePctSum: 0,
      competitorCountSum: 0,
      rawDominanceMultiplierSum: 0,
      dominanceDensityFactorSum: 0,
      dominanceMultiplierSum: 0,
      unitPriceAnchorSum: 0,
      cashHeadroomAnchorSum: 0,
      requestedUnitsSum: 0,
    });
    bucket.observations++;
    bucket.marketSharePctSum += finite(observation.marketSharePct);
    bucket.competitorCountSum += finite(observation.competitorCount);
    bucket.rawDominanceMultiplierSum += finite(observation.rawDominanceMultiplier);
    bucket.dominanceDensityFactorSum += finite(observation.dominanceDensityFactor);
    bucket.dominanceMultiplierSum += finite(observation.dominanceMultiplier);
    bucket.unitPriceAnchorSum += finite(observation.unitPriceAnchor);
    bucket.cashHeadroomAnchorSum += finite(observation.cashHeadroomAnchor);
    bucket.requestedUnitsSum += finite(observation.requestedUnits);
  }
  return result;
}
