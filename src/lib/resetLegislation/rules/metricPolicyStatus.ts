import type { LawFamilyDefinition, LegislativePosition } from "../catalog";
import type { OpeningLawReference } from "../openingLaw";
import type { ResetLawProgramDocument } from "../program";
import type { LawChoice, LawScope } from "./eligibility";
import type { LawProgramDelivery } from "./programEffects";
import { openingChoice1991 } from "./reviewCatalog";
import type { ResetCountry } from "../fundingOwner";

export type MetricLawState =
  "equilibrium" | "pushing_favorable" | "pushing_unfavorable" | "implementation_stalled";

export interface MetricLawStatus {
  familyId: string;
  familyTitle: string;
  currentLawTitle: string;
  policyLevelTitle: string;
  state: MetricLawState;
  favorableNormalizedPoints: number | null;
}

type CurrentProgram = Pick<
  ResetLawProgramDocument,
  "familyId" | "choice" | "titleSnapshot" | "primaryMetricEffects"
>;

function levelTitle(family: LawFamilyDefinition, choice: LawChoice): string {
  if (choice === "leave_to_states") return "Leave it to the States";
  return family.levels.find((level) => level.position === choice)?.title ?? "Current policy level";
}

function enactedState(points: number, implementationFactor: number): MetricLawState {
  if (implementationFactor === 0) return "implementation_stalled";
  if (Math.abs(points) < 0.00005) return "equilibrium";
  return points > 0 ? "pushing_favorable" : "pushing_unfavorable";
}

/**
 * Portable read model for the laws that define or are changing each metric's
 * policy environment. Opening laws are the equilibrium already reflected in
 * the seeded observation. A replacement law reports only its funded modeled
 * pressure; the metric owner remains responsible for the observed value.
 */
export function buildMetricLawStatuses(input: {
  country: ResetCountry;
  scope: LawScope;
  families: readonly LawFamilyDefinition[];
  references: Readonly<Record<string, OpeningLawReference>>;
  programs: readonly CurrentProgram[];
  delivery: readonly LawProgramDelivery[];
}): Readonly<Record<string, MetricLawStatus[]>> {
  const programsByFamily = new Map(input.programs.map((program) => [program.familyId, program]));
  const deliveryByFamily = new Map(
    input.delivery.map((row) => [row.familyId, row.implementationFactor])
  );
  const byMetric = new Map<string, MetricLawStatus[]>();

  for (const family of input.families) {
    if (!family.availability[input.scope].includes(input.country)) continue;
    const reference = input.references[family.id];
    if (!reference) continue;
    const program = programsByFamily.get(family.id);
    const openingChoice: LegislativePosition = openingChoice1991(reference);

    for (const metricId of family.primaryMetricIds) {
      const rows = byMetric.get(metricId) ?? [];
      if (!program) {
        rows.push({
          familyId: family.id,
          familyTitle: family.title,
          currentLawTitle: reference.currentLaw,
          policyLevelTitle: levelTitle(family, openingChoice),
          state: "equilibrium",
          favorableNormalizedPoints: null,
        });
      } else {
        const implementationFactor = deliveryByFamily.get(family.id) ?? 0;
        if (
          !Number.isFinite(implementationFactor) ||
          implementationFactor < 0 ||
          implementationFactor > 1
        ) {
          throw new Error(`Invalid implementation factor for ${family.id}`);
        }
        const authored = program.primaryMetricEffects.find(
          (effect) => effect.metricId === metricId
        );
        const points = Number(
          ((authored?.favorableNormalizedPoints ?? 0) * implementationFactor).toFixed(4)
        );
        rows.push({
          familyId: family.id,
          familyTitle: family.title,
          currentLawTitle: program.titleSnapshot,
          policyLevelTitle: levelTitle(family, program.choice),
          state: enactedState(points, implementationFactor),
          favorableNormalizedPoints: points,
        });
      }
      byMetric.set(metricId, rows);
    }
  }

  return Object.fromEntries(
    [...byMetric.entries()].map(([metricId, rows]) => [
      metricId,
      rows.sort((a, b) => a.familyId.localeCompare(b.familyId)),
    ])
  );
}
