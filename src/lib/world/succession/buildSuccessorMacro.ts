import type { ExtractableResource } from "@/lib/constants/commodities";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import { computeMacroContribution } from "@/lib/world/macro/kernel";
import { buildMacroCountryFromSpec } from "@/lib/world/macro/seedBuilder";
import type { MacroCountryState, MacroEconomicSystem } from "@/lib/world/macro/types";
import type { SuccessorTerritory } from "./rules/territory";

export interface SuccessorMacroTerms {
  territory: SuccessorTerritory;
  displayName: string;
  presetId: string;
  currentTurn: number;
  economicSystem: MacroEconomicSystem;
  sourceGdpToGameUnit: number;
  fiscalCapacity: number;
  stability: number;
  tradeExposure: number;
  sectorWeights: Partial<Record<OperatingSectorType, number>>;
  resources: Partial<Record<ExtractableResource, number>>;
}

export function buildSuccessorMacroCountry(
  terms: SuccessorMacroTerms,
  now: Date
): MacroCountryState {
  if (
    !Number.isSafeInteger(terms.currentTurn) ||
    terms.currentTurn < 1 ||
    !Number.isSafeInteger(terms.territory.population) ||
    terms.territory.population < 1 ||
    !Number.isFinite(terms.territory.annualGdpAnchor) ||
    terms.territory.annualGdpAnchor <= 0 ||
    !Number.isFinite(terms.sourceGdpToGameUnit) ||
    terms.sourceGdpToGameUnit <= 0
  ) {
    throw new Error("Successor territory and GDP conversion must be positive and finite");
  }
  const annualGdpGameUnits = terms.territory.annualGdpAnchor * terms.sourceGdpToGameUnit;
  if (!Number.isFinite(annualGdpGameUnits) || annualGdpGameUnits <= 0)
    throw new Error("Converted successor output exceeds supported precision");

  const country = buildMacroCountryFromSpec(
    {
      entityId: terms.territory.entityId,
      displayName: terms.displayName,
      economicSystem: terms.economicSystem,
      population: terms.territory.population,
      annualGdpGameUnits,
      fiscalCapacity: terms.fiscalCapacity,
      stability: terms.stability,
      tradeExposure: terms.tradeExposure,
      sectorWeights: terms.sectorWeights,
      resources: terms.resources,
    },
    now,
    {
      presetId: terms.presetId,
      simulationTier: "background-macro",
      provenance: "succession-derived",
    }
  );
  country.contribution = computeMacroContribution(country, terms.currentTurn);
  country.lastMacroTickTurn = terms.currentTurn;
  return country;
}
