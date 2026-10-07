import {
  buildResetLawOpeningBoard,
  type ResetLawOpeningBoard,
} from "@/lib/resetLegislation/rules/openingBoard";
import type { OpeningLawReference } from "@/lib/resetLegislation/openingLaw";
import type { ResetRegionalOpeningBoard } from "@/lib/resetFinance/rules/regionalOpeningBoard";
import type { ResetMetricSnapshot } from "@/lib/resetMetrics/rules/snapshot";

function rekeyReference(reference: OpeningLawReference): OpeningLawReference {
  return {
    ...reference,
    key: `IE:regional:${reference.familyId}`,
    country: "IE",
    scope: "regional",
    sourceComponents: reference.sourceComponents.map((component) => ({ ...component })),
  };
}

export function transferResetV2MetricToIreland(
  source: ResetMetricSnapshot,
  regionId: string
): ResetMetricSnapshot {
  return {
    ...source,
    _id: `IE:${regionId}`,
    countryId: "IE",
    scope: "regional",
    regionId,
    observations: structuredClone(source.observations),
    history: structuredClone(source.history),
  };
}

export function transferResetV2LawToIreland(
  source: ResetLawOpeningBoard,
  regionId: string
): ResetLawOpeningBoard {
  return buildResetLawOpeningBoard({
    worldId: source.worldId,
    countryId: "IE",
    regionId,
    sourceTurn: source.sourceTurn,
    references: Object.values(source.references).map(rekeyReference),
  });
}

export function transferResetV2FiscalToIreland(
  source: ResetRegionalOpeningBoard,
  regionId: string
): ResetRegionalOpeningBoard {
  return {
    ...source,
    _id: `IE:${regionId}`,
    countryId: "IE",
    regionId,
    allocatedClaims: source.allocatedClaims.map((claim) => ({ ...claim })),
  };
}
