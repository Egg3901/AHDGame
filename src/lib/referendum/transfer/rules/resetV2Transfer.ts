import {
  buildResetLawOpeningBoard,
  type ResetLawOpeningBoard,
} from "@/lib/resetLegislation/rules/openingBoard";
import type { OpeningLawReference } from "@/lib/resetLegislation/openingLaw";
import type { ResetRegionalOpeningBoard } from "@/lib/resetFinance/rules/regionalOpeningBoard";
import type { ResetMetricSnapshot } from "@/lib/resetMetrics/rules/snapshot";

function rekeyReference(reference: OpeningLawReference, scale: number): OpeningLawReference {
  return {
    ...reference,
    key: `IE:regional:${reference.familyId}`,
    country: "IE",
    scope: "regional",
    sourceComponents: reference.sourceComponents.map((component) => ({
      ...component,
      annualBooked: component.annualBooked * scale,
    })),
  };
}

export function transferResetV2MetricToIreland(
  source: ResetMetricSnapshot,
  regionId: string,
  scale = 1
): ResetMetricSnapshot {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Invalid reunification currency scale");
  return {
    ...source,
    _id: `IE:${regionId}`,
    countryId: "IE",
    scope: "regional",
    regionId,
    observations: Object.fromEntries(
      Object.entries(source.observations).map(([id, value]) => [
        id,
        id === "02" && value.value != null
          ? { ...value, value: value.value * scale }
          : { ...value },
      ])
    ),
    history:
      source.history &&
      Object.fromEntries(
        Object.entries(source.history).map(([id, points]) => [
          id,
          points.map((point) => ({
            ...point,
            value: point.value * (id === "02" ? scale : 1),
          })),
        ])
      ),
  };
}

export function transferResetV2LawToIreland(
  source: ResetLawOpeningBoard,
  regionId: string,
  scale = 1
): ResetLawOpeningBoard {
  return buildResetLawOpeningBoard({
    worldId: source.worldId,
    countryId: "IE",
    regionId,
    sourceTurn: source.sourceTurn,
    references: Object.values(source.references).map((reference) =>
      rekeyReference(reference, scale)
    ),
  });
}

export function transferResetV2FiscalToIreland(
  source: ResetRegionalOpeningBoard,
  regionId: string,
  scale = 1
): ResetRegionalOpeningBoard {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("Invalid reunification currency scale");
  return {
    ...source,
    _id: `IE:${regionId}`,
    countryId: "IE",
    regionId,
    annualSpending: source.annualSpending * scale,
    familyOwned: source.familyOwned * scale,
    otherExistingServices: source.otherExistingServices * scale,
    allocatedClaims: source.allocatedClaims.map((claim) => ({
      ...claim,
      annualBooked: claim.annualBooked * scale,
    })),
  };
}
