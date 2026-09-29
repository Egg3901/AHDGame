import type { WorldEntityManifestEntry } from "@/lib/world/worldEntityManifest";
import type { MacroCountryState } from "@/lib/world/macro/types";
import { buildSuccessorMacroCountry, type SuccessorMacroTerms } from "./buildSuccessorMacro";
import { evaluateSuccessionApproval, type SuccessionApprovalInput } from "./rules/decision";
import type { SuccessionFinancialPlan } from "./rules/financialSettlement";
import type { SuccessionRegion, SuccessorTerritory } from "./rules/territory";

export interface SuccessionActivationInput {
  settlementId: string;
  approval: SuccessionApprovalInput;
  source: WorldEntityManifestEntry;
  successors: readonly WorldEntityManifestEntry[];
  /** Live source regions read for this settlement, before any territory moves. */
  sourceRegions: readonly SuccessionRegion[];
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
  const {
    settlementId,
    approval,
    source,
    successors,
    sourceRegions,
    territories,
    finances,
    macroTerms,
    now,
  } = input;
  const decision = evaluateSuccessionApproval(approval);
  if (
    !settlementId.trim() ||
    approval.settlementId !== settlementId ||
    decision.status !== "ready" ||
    finances.settlementId !== settlementId ||
    finances.servicingIssuerId !== source.entityId ||
    source.status !== "sovereign" ||
    territories.length < 2
  ) {
    throw new Error("Activation requires an approved settlement and sovereign source");
  }
  const territoryById = new Map(territories.map((territory) => [territory.entityId, territory]));
  const successorById = new Map(successors.map((successor) => [successor.entityId, successor]));
  const sourceByRegion = new Map(sourceRegions.map((region) => [region.regionId, region]));
  const assigned = new Set<string>();
  if (
    sourceRegions.length === 0 ||
    sourceByRegion.size !== sourceRegions.length ||
    sourceRegions.some(
      (region) =>
        !region.regionId.trim() ||
        !Number.isSafeInteger(region.population) ||
        region.population < 0 ||
        !Number.isFinite(region.annualGdpAnchor) ||
        region.annualGdpAnchor < 0
    )
  )
    throw new Error("Source territory is empty or contains duplicate regions");
  for (const territory of territories) {
    let population = 0;
    let annualGdpAnchor = 0;
    for (const regionId of territory.regionIds) {
      const region = sourceByRegion.get(regionId);
      if (!region || assigned.has(regionId))
        throw new Error("Successor territory must partition live source regions exactly once");
      assigned.add(regionId);
      population += region.population;
      annualGdpAnchor += region.annualGdpAnchor;
    }
    if (
      territory.regionIds.length === 0 ||
      population !== territory.population ||
      Math.abs(annualGdpAnchor - territory.annualGdpAnchor) > 1e-8
    )
      throw new Error("Successor territory totals differ from live source regions");
  }
  if (assigned.size !== sourceByRegion.size)
    throw new Error("Successor territory must partition live source regions exactly once");
  const continuing = territoryById.has(source.entityId);
  const expectedTargets = territories.length - (continuing ? 1 : 0);
  if (
    approval.requiredParticipants.length !== territories.length ||
    approval.requiredParticipants.some((id) => !territoryById.has(id)) ||
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
      [...territoryById.keys()].sort().join(",") ||
    !Number.isSafeInteger(finances.financialAssetsMinor) ||
    !Number.isSafeInteger(finances.creditorDebtMinor) ||
    finances.financialAssetsMinor < 0 ||
    finances.creditorDebtMinor < 0 ||
    Object.values(finances.assetAllocation).some(
      (amount) => !Number.isSafeInteger(amount) || amount < 0
    ) ||
    Object.values(finances.debtResponsibility).some(
      (amount) => !Number.isSafeInteger(amount) || amount < 0
    ) ||
    Object.values(finances.assetAllocation).reduce((sum, amount) => sum + BigInt(amount), 0n) !==
      BigInt(finances.financialAssetsMinor) ||
    Object.values(finances.debtResponsibility).reduce((sum, amount) => sum + BigInt(amount), 0n) !==
      BigInt(finances.creditorDebtMinor)
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
