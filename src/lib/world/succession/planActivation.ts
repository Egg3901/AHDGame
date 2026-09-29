import type { WorldEntityManifestEntry } from "@/lib/world/worldEntityManifest";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { buildSuccessorMacroCountry, type SuccessorMacroTerms } from "./buildSuccessorMacro";
import type { SuccessionFinancialPlan } from "./rules/financialSettlement";
import type { SuccessorTerritory } from "./rules/territory";

export interface SuccessionActivationInput {
  settlementId: string;
  source: WorldEntityManifestEntry;
  successors: readonly WorldEntityManifestEntry[];
  territories: readonly SuccessorTerritory[];
  finances: SuccessionFinancialPlan;
  macroTerms: Readonly<Record<string, Omit<SuccessorMacroTerms, "territory" | "displayName">>>;
  now: Date;
}

/** Prepare complete sovereign and aggregate records before any settlement write. */
export function planSuccessionActivation(input: SuccessionActivationInput): {
  sourceEntity: WorldEntityManifestEntry;
  successorEntities: WorldEntityManifestEntry[];
  macroCountries: MacroCountryState[];
} {
  const { settlementId, source, successors, territories, finances, macroTerms, now } = input;
  if (
    !settlementId.trim() ||
    finances.settlementId !== settlementId ||
    finances.servicingIssuerId !== source.entityId ||
    source.status !== "sovereign" ||
    territories.length < 2
  ) {
    throw new Error("Activation requires an approved settlement and sovereign source");
  }
  const territoryById = new Map(territories.map((territory) => [territory.entityId, territory]));
  const successorById = new Map(successors.map((successor) => [successor.entityId, successor]));
  const continuing = territoryById.has(source.entityId);
  const expectedTargets = territories.length - (continuing ? 1 : 0);
  if (
    territoryById.size !== territories.length ||
    successorById.size !== successors.length ||
    successors.length !== expectedTargets ||
    Object.keys(macroTerms).length !== expectedTargets ||
    finances.servicingEntityKind !== (continuing ? "continuing-state" : "legacy-administration")
  ) {
    throw new Error("Settlement territory, targets and servicing issuer disagree");
  }
  const targetIds = [...territoryById.keys()].filter((id) => id !== source.entityId).sort();
  if (
    Object.keys(finances.assetAllocation).sort().join(",") !==
      [...territoryById.keys()].sort().join(",") ||
    Object.keys(finances.debtResponsibility).sort().join(",") !==
      [...territoryById.keys()].sort().join(",")
  ) {
    throw new Error("Financial allocations do not match the approved territory");
  }
  const successorEntities: WorldEntityManifestEntry[] = [];
  const macroCountries: MacroCountryState[] = [];
  for (const entityId of targetIds) {
    const target = successorById.get(entityId);
    const territory = territoryById.get(entityId);
    const terms = macroTerms[entityId];
    if (
      !target ||
      !territory ||
      !terms ||
      (target.status !== "emergent" && target.status !== "dependent") ||
      target.parentEntityId !== source.entityId ||
      target.presetId !== source.presetId ||
      target.simulationTier !== "background-macro" ||
      terms.presetId !== source.presetId
    ) {
      throw new Error(`Successor ${entityId} is not an eligible background target`);
    }
    successorEntities.push({
      ...target,
      status: "sovereign",
      parentEntityId: undefined,
      recognition: { status: "widely-recognized" },
      un: { state: "eligible" },
    });
    macroCountries.push(
      buildSuccessorMacroCountry({ ...terms, territory, displayName: target.displayName }, now)
    );
  }
  return {
    sourceEntity: continuing
      ? source
      : {
          ...source,
          status: "dissolved",
          simulationTier: "historical-presence",
          economicArchetype: "none",
          legacyAccess: "hidden",
          readiness: {
            autonomous: "blocked",
            player: "blocked",
            hardBlockers: ["This federation was dissolved by an approved settlement."],
            flavorGaps: [],
          },
        },
    successorEntities,
    macroCountries,
  };
}
