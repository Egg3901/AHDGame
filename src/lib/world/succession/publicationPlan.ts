import type { MacroCountryState } from "@/lib/world/macro/types";
import {
  hashSettlementPayload,
  type FederationSettlementIntentRecord,
  type LiveSettlementSnapshot,
} from "./settlementIntent";
import {
  type FederationSettlementApplicationRecord,
  type RuntimeWorldEntityState,
} from "./runtimeEntities";

/** A complete, deterministic inventory for the settlement writer. The receipt
 * is a candidate only: it must be inserted after every material effect has
 * reconciled. Building this value publishes nothing. */
export interface FederationPublicationPlan {
  receipt: FederationSettlementApplicationRecord;
  entityStates: RuntimeWorldEntityState[];
  macroCountries: MacroCountryState[];
  stateTransfers: LiveSettlementSnapshot["stateTransfers"];
  custodyAssignments: LiveSettlementSnapshot["activationPlan"]["custodyAssignments"];
  residencePlans: LiveSettlementSnapshot["residencePlans"];
  privateFirmPlans: LiveSettlementSnapshot["privateFirmPlans"];
  fiscalShares: LiveSettlementSnapshot["fiscalShares"];
  sourceResidents: LiveSettlementSnapshot["residents"];
  sourceFirms: LiveSettlementSnapshot["firms"];
}

export function buildFederationPublicationPlan(
  intent: FederationSettlementIntentRecord,
  snapshot: LiveSettlementSnapshot
): FederationPublicationPlan {
  const { activationPlan, stateTransfers, residencePlans, privateFirmPlans, fiscalShares } =
    snapshot;
  const entries = [activationPlan.sourceEntity, ...activationPlan.successorEntities];
  const entityIds = entries.map((entry) => entry.entityId);
  if (
    intent.status !== "staged" ||
    intent.presetId !== "1991-default" ||
    intent.payloadHash !== snapshot.payloadHash ||
    hashSettlementPayload(intent.payload) !== intent.payloadHash ||
    intent.sourceEntityId !== activationPlan.sourceEntity.entityId ||
    intent._id !== `${intent.presetId}:${intent.settlementId}:${intent.revision}` ||
    entityIds.length < 2 ||
    new Set(entityIds).size !== entityIds.length ||
    entries.some((entry) => entry.presetId !== intent.presetId) ||
    activationPlan.macroCountries.length !== entries.length - 1 ||
    activationPlan.macroCountries.some(
      (country) =>
        country.presetId !== intent.presetId ||
        !entityIds.includes(country.entityId) ||
        country.entityId === intent.sourceEntityId
    ) ||
    stateTransfers.length === 0 ||
    stateTransfers.some((state) => !entityIds.includes(state.successorEntityId)) ||
    fiscalShares.filter((share) => share.kind !== "legacy-administration").length !==
      activationPlan.successorEntities.length +
        (activationPlan.sourceEntity.status === "dissolved" ? 0 : 1) ||
    fiscalShares.filter((share) => share.kind === "legacy-administration").length !==
      (activationPlan.sourceEntity.status === "dissolved" ? 1 : 0) ||
    privateFirmPlans.length !== snapshot.firms.length ||
    privateFirmPlans.some(
      (firm) => !snapshot.firms.some((source) => source.corporationId === firm.corporationId)
    ) ||
    residencePlans.some(
      (resident) =>
        !snapshot.residents.some((source) => source.characterId === resident.characterId)
    )
  )
    throw new Error("Federation publication inventory disagrees with approved entities");
  const receipt: FederationSettlementApplicationRecord = {
    _id: intent._id,
    presetId: intent.presetId,
    settlementId: intent.settlementId,
    revision: intent.revision,
    sourceEntityId: intent.sourceEntityId,
    entityIds,
    status: "applied",
    appliedOnTurn: intent.appliedOnTurn,
    appliedAt: intent.createdAt,
  };
  return {
    receipt,
    entityStates: entries.map((entry) => ({
      _id: `${intent.presetId}:${entry.entityId}`,
      presetId: intent.presetId,
      entityId: entry.entityId,
      applicationId: intent._id,
      appliedOnTurn: intent.appliedOnTurn,
      entry,
    })),
    macroCountries: activationPlan.macroCountries,
    stateTransfers,
    custodyAssignments: activationPlan.custodyAssignments,
    residencePlans,
    privateFirmPlans,
    fiscalShares,
    sourceResidents: snapshot.residents,
    sourceFirms: snapshot.firms,
  };
}
