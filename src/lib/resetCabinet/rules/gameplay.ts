/** Temporary input pressure. Never persist these adjusted inputs as owner observations. */
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { RegistryNode } from "@/lib/metricEngine/types";
import type { ApplicableTemporaryTargetEffect, TemporaryTargetEffect } from "./actions";
import { mergeApplicableActionEffects } from "./actions";

export interface CabinetDiscipline {
  countryId: string;
  parties: readonly string[];
  bonus: number;
}

export function cabinetDisciplineForParty(
  discipline: readonly CabinetDiscipline[],
  countryId: string,
  partyId: string | null | undefined
): number {
  if (!partyId) return 0;
  return (
    discipline.find((row) => row.countryId === countryId && row.parties.includes(partyId))?.bonus ??
    0
  );
}

/** Existing political families consumed by production, health, energy and demographics. */
export const CABINET_GAMEPLAY_FAMILIES: Readonly<Record<string, PoliticalMetricId>> = {
  M01: "economy.workerSecurity",
  M03: "economy.householdIncome",
  M11: "education.attainment",
  M12: "education.standards",
  M13: "education.adultSkills",
  M18: "health.systemEfficiency",
  M22: "health.socialInsurance",
  M23: "health.prevention",
  M24: "infrastructure.publicHousing",
  M25: "infrastructure.development",
  M26: "infrastructure.condition",
  M27: "infrastructure.transit",
  M30: "infrastructure.utilities",
  M31: "order.safety",
  M32: "order.safety",
  M34: "order.dueProcess",
  M35: "environment.urbanAir",
  M38: "environment.stewardship",
  M39: "environment.conservation",
  M41: "infrastructure.publicHousing",
  M42: "health.socialInsurance",
  M43: "society.integration",
  M47: "governance.openness",
  M48: "governance.integrity",
  M57: "defense.armedForces",
  M58: "environment.energySecurity",
  "S:borderSecurity": "governance.administration",
  "S:costOfLiving": "economy.householdIncome",
  "S:roboticsAdoption": "economy.productivity",
  "S:smallBusinessFormation": "economy.competition",
  "S:tradeGrowth": "defense.diplomacy",
  "S:workLifeBalance": "economy.workerSecurity",
};

export function cabinetActionScopeApplies(scope: string, regionId?: string): boolean {
  if (scope === "Nat") return true;
  // The current owner model has regional services, but no separate veteran cohort board.
  if (scope === "Vet") return regionId !== undefined;
  return (
    (scope === "NI" && regionId === "NIR") ||
    (scope === "SCT" && regionId === "SCO") ||
    (scope === "WAL" && regionId === "WAL")
  );
}

export function cabinetEffectsForRegion(
  effects: readonly TemporaryTargetEffect[],
  countryId: string,
  regionId?: string
): ApplicableTemporaryTargetEffect[] {
  return mergeApplicableActionEffects(
    effects.filter(
      (effect) => effect.country === countryId && cabinetActionScopeApplies(effect.scope, regionId)
    )
  );
}

/** Authored normalized test points stay points on the existing 0-100 family scale. */
export function applyCabinetPoliticalInputs(
  values: Readonly<Record<PoliticalMetricId, number>>,
  effects: readonly ApplicableTemporaryTargetEffect[]
): Record<PoliticalMetricId, number>;
export function applyCabinetPoliticalInputs(
  values: Readonly<Partial<Record<PoliticalMetricId, number>>>,
  effects: readonly ApplicableTemporaryTargetEffect[]
): Partial<Record<PoliticalMetricId, number>>;
export function applyCabinetPoliticalInputs(
  values: Readonly<Partial<Record<PoliticalMetricId, number>>>,
  effects: readonly ApplicableTemporaryTargetEffect[]
): Partial<Record<PoliticalMetricId, number>> {
  const pressure = new Map<PoliticalMetricId, number>();
  for (const effect of effects) {
    const family = CABINET_GAMEPLAY_FAMILIES[effect.target];
    if (!family) continue;
    pressure.set(
      family,
      Math.min(0.2, (pressure.get(family) ?? 0) + effect.favorableNormalizedPoints)
    );
  }
  const result = { ...values };
  for (const [family, points] of pressure) {
    const value = result[family];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[family] = Math.max(0, Math.min(100, value + points));
    }
  }
  return result;
}

/** Temporary service response is separate from the observed outcome and named conditions. */
export function cabinetApprovalResponse(
  effects: readonly ApplicableTemporaryTargetEffect[]
): number {
  return Math.min(
    8,
    effects.reduce(
      (sum, effect) =>
        sum + (effect.target === "S:partyDiscipline" ? 0 : effect.favorableNormalizedPoints),
      0
    )
  );
}

/** A discipline action shifts willingness, never forces a ballot or changes player votes. */
export function cabinetWhipBonus(effects: readonly ApplicableTemporaryTargetEffect[]): number {
  return (
    effects.find((effect) => effect.target === "S:partyDiscipline")?.favorableNormalizedPoints ?? 0
  );
}

/** Discipline is a bounded relative increase in an existing, explicitly directed whip. */
export function applyCabinetWhipPressure(force: number, bonus = 0): number {
  if (!Number.isFinite(bonus) || bonus < 0 || bonus > 0.2) {
    throw new Error("Invalid Cabinet discipline pressure");
  }
  return force * (1 + bonus);
}

/** Target pressure goes through the macro engine's existing inertia and bounds. */
export function cabinetMacroTargetNudges(
  effects: readonly ApplicableTemporaryTargetEffect[]
): Record<string, number> {
  const targets: Readonly<Record<string, readonly [string, number]>> = {
    M01: ["economic.unemploymentRate", -1],
    M03: ["economic.povertyRate", -1],
    "S:tradeGrowth": ["economic.tradeGrowth", 1],
    "S:costOfLiving": ["economic.costOfLiving", -1],
    "S:roboticsAdoption": ["economic.productivityGrowth", 1],
  };
  const nudges: Record<string, number> = {};
  for (const effect of effects) {
    const target = targets[effect.target];
    if (target) nudges[target[0]] = target[1] * effect.favorableNormalizedPoints;
  }
  return nudges;
}

/** Deployment and entry pressure improve supply capacity through the normal output-gap path. */
export function cabinetProductionPressure(
  effects: readonly ApplicableTemporaryTargetEffect[]
): number {
  return Math.min(
    0.2,
    effects.reduce(
      (sum, effect) =>
        sum +
        (effect.target === "S:roboticsAdoption" || effect.target === "S:smallBusinessFormation"
          ? effect.favorableNormalizedPoints
          : 0),
      0
    )
  );
}

/** Keep sub-display-unit pressure from rounding into a permanent baseline offset. */
export function cabinetMacroRegistry(nodes: readonly RegistryNode[]): RegistryNode[] {
  const affected = new Set([
    "economic.unemploymentRate",
    "economic.povertyRate",
    "economic.tradeGrowth",
    "economic.costOfLiving",
    "economic.productivityGrowth",
  ]);
  return nodes.map((node) =>
    affected.has(node.id)
      ? { ...node, baselineDecimals: Math.max(node.baselineDecimals ?? node.decimals ?? 3, 6) }
      : node
  );
}
