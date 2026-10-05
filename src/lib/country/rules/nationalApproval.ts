import {
  applyModifiers,
  evaluateModifiers,
  type ActiveModifier,
  type EvaluateModifiersOptions,
} from "@/lib/utils/approvalModifiers";

export interface ApprovalRegion {
  base: number;
  population: number;
  metrics: Record<string, Record<string, number>>;
}

/** The same population aggregation and two modifier scopes as the turn snapshot. */
export function nationalApprovalFromRegions(
  regions: ApprovalRegion[],
  context: EvaluateModifiersOptions,
  nationalModifiers: ActiveModifier[]
): { approval: number; base: number; regionalModifiers: ActiveModifier[] } {
  const population = regions.reduce((sum, region) => sum + Math.max(0, region.population), 0);
  const mean = (values: number[]) =>
    population > 0
      ? Math.round(
          (values.reduce((sum, value, i) => sum + value * Math.max(0, regions[i].population), 0) /
            population) *
            10
        ) / 10
      : 50;
  const base = mean(regions.map((region) => region.base));
  const regionalApproval = mean(
    regions.map((region) => applyModifiers(region.base, evaluateModifiers(region.metrics, context)))
  );
  const effect = Math.round((regionalApproval - base) * 10) / 10;
  const regionalModifiers: ActiveModifier[] =
    effect === 0
      ? []
      : [
          {
            id: "regional_conditions",
            label: "Regional conditions (population weighted)",
            effect,
            source: "metric",
            marginEffect: 0,
          },
        ];
  return { base, approval: applyModifiers(regionalApproval, nationalModifiers), regionalModifiers };
}
