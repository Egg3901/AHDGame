import type { ResetRegionalOpeningBoard } from "@/lib/resetFinance/rules/regionalOpeningBoard";
import type { OpeningLawReference } from "@/lib/resetLegislation/openingLaw";
import { regionalizeOpeningReferences } from "@/lib/resetLegislation/rules/regionalizeOpeningReferences";
import type { ResetMetricSnapshot } from "@/lib/resetMetrics/rules/snapshot";
import type { SecedingCountryId } from "../subRegions";

export interface SuccessorRegionSeed {
  id: string;
  population: number;
}

export function buildSuccessorMetricRows(input: {
  countryId: SecedingCountryId;
  aggregate: ResetMetricSnapshot;
  regions: readonly SuccessorRegionSeed[];
}): ResetMetricSnapshot[] {
  const { aggregate, countryId, regions } = input;
  if (aggregate.scope !== "regional" || regions.length === 0) {
    throw new Error(`${countryId} metric promotion requires a regional aggregate and sub-regions`);
  }
  return [
    {
      ...aggregate,
      _id: `${countryId}:national`,
      countryId,
      scope: "national",
      regionId: undefined,
      observations: structuredClone(aggregate.observations),
      history: structuredClone(aggregate.history),
    },
    ...regions.map((region) => ({
      ...aggregate,
      _id: `${countryId}:${region.id}`,
      countryId,
      regionId: region.id,
      observations: structuredClone(aggregate.observations),
      history: structuredClone(aggregate.history),
    })),
  ];
}

export function buildSuccessorRegionalRows(input: {
  countryId: SecedingCountryId;
  aggregate: ResetRegionalOpeningBoard;
  regionalReferences: readonly OpeningLawReference[];
  regions: readonly SuccessorRegionSeed[];
}): Array<{
  fiscal: ResetRegionalOpeningBoard;
  references: OpeningLawReference[];
}> {
  const { aggregate, countryId, regionalReferences, regions } = input;
  const totalPopulation = regions.reduce((sum, region) => {
    if (!region.id || !Number.isFinite(region.population) || region.population <= 0) {
      throw new Error(`${countryId} v2 promotion has an invalid sub-region population`);
    }
    return sum + region.population;
  }, 0);
  if (regions.length === 0 || !Number.isFinite(totalPopulation) || totalPopulation <= 0) {
    throw new Error(`${countryId} v2 promotion has no usable sub-region population`);
  }

  return regions.map((region) => {
    const share = region.population / totalPopulation;
    const allocatedClaims = aggregate.allocatedClaims.map((claim) => ({
      ...claim,
      annualBooked: claim.annualBooked * share,
    }));
    const familyOwned = allocatedClaims.reduce((sum, claim) => sum + claim.annualBooked, 0);
    const annualSpending = aggregate.annualSpending * share;
    const fiscal: ResetRegionalOpeningBoard = {
      ...aggregate,
      _id: `${countryId}:${region.id}`,
      countryId,
      regionId: region.id,
      annualSpending,
      familyOwned,
      otherExistingServices: annualSpending - familyOwned,
      allocatedClaims,
    };
    return {
      fiscal,
      references: regionalizeOpeningReferences(regionalReferences, allocatedClaims),
    };
  });
}
