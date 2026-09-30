import type { Db } from "mongodb";
import { hashSettlementPayload } from "./settlementIntent";
import type { FederationPublicationPlan } from "./publicationPlan";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
  overlayRuntimeWorldEntities,
  validateAppliedEntityStates,
} from "./runtimeEntities";

export const FEDERATION_PUBLICATION_PREPARATIONS_COLLECTION = "federationPublicationPreparations";
export const FEDERATION_PREPARED_EFFECTS_COLLECTION = "federationPreparedEffects";

export type FederationPreparedEffectKind =
  | "entity-state"
  | "macro-country"
  | "state-transfer"
  | "custody"
  | "fiscal-share"
  | "resident-choice"
  | "firm-choice";

export interface FederationPreparedEffect {
  _id: string;
  applicationId: string;
  kind: FederationPreparedEffectKind;
  key: string;
  value: Record<string, unknown>;
  valueHash: string;
  createdAt: Date;
}

export interface FederationPublicationPreparation {
  _id: string;
  applicationId: string;
  status: "prepared";
  effectIds: string[];
  effectsHash: string;
  createdAt: Date;
}

function enumerateEffects(plan: FederationPublicationPlan, now: Date): FederationPreparedEffect[] {
  const applicationId = plan.receipt._id;
  const values: Array<{
    kind: FederationPreparedEffectKind;
    key: string;
    value: Record<string, unknown>;
  }> = [
    ...plan.entityStates.map((value) => ({
      kind: "entity-state" as const,
      key: value.entityId,
      value: { ...value },
    })),
    ...plan.macroCountries.map((value) => ({
      kind: "macro-country" as const,
      key: value.entityId,
      value: { ...value },
    })),
    ...plan.stateTransfers.map((value) => ({
      kind: "state-transfer" as const,
      key: value.stateId,
      value: { ...value },
    })),
    ...plan.custodyAssignments.map((value) => ({
      kind: "custody" as const,
      key: value.assetId,
      value: { ...value },
    })),
    ...plan.fiscalShares.map((value) => ({
      kind: "fiscal-share" as const,
      key: value.entityId,
      value: { ...value },
    })),
    ...plan.residencePlans.map((value) => ({
      kind: "resident-choice" as const,
      key: value.characterId,
      value: { ...value },
    })),
    ...plan.privateFirmPlans.map((value) => ({
      kind: "firm-choice" as const,
      key: value.corporationId,
      value: { ...value },
    })),
  ];
  const effects = values.map(({ kind, key, value }) => ({
    _id: `${applicationId}:${kind}:${key}`,
    applicationId,
    kind,
    key,
    value,
    valueHash: hashSettlementPayload(value),
    createdAt: now,
  }));
  if (new Set(effects.map((effect) => effect._id)).size !== effects.length)
    throw new Error("Federation publication repeats an effect key");
  return effects.sort((a, b) => a._id.localeCompare(b._id));
}

/** Prepare inert, keyed effects before any country or balance changes. A crash
 * may leave a prefix of rows; retry fills it, and a changed source cannot
 * reuse this application key. No applied receipt is written here. */
export async function prepareFederationPublication(
  db: Db,
  plan: FederationPublicationPlan,
  now: Date
): Promise<FederationPublicationPreparation> {
  if (
    !Number.isFinite(now.getTime()) ||
    plan.receipt.status !== "applied" ||
    plan.receipt._id !==
      `${plan.receipt.presetId}:${plan.receipt.settlementId}:${plan.receipt.revision}`
  )
    throw new Error("Federation publication needs a valid candidate receipt and time");
  const applied = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({
      presetId: plan.receipt.presetId,
      sourceEntityId: plan.receipt.sourceEntityId,
      status: "applied",
    });
  if (applied && applied._id !== plan.receipt._id)
    throw new Error("Federation source already has another applied settlement");
  overlayRuntimeWorldEntities(
    plan.receipt.presetId,
    plan.entityStates,
    validateAppliedEntityStates(plan.receipt.presetId, [plan.receipt], plan.entityStates)
  );
  const effects = enumerateEffects(plan, now);
  const intended: FederationPublicationPreparation = {
    _id: plan.receipt._id,
    applicationId: plan.receipt._id,
    status: "prepared",
    effectIds: effects.map((effect) => effect._id),
    effectsHash: hashSettlementPayload(effects.map(({ _id, valueHash }) => [_id, valueHash])),
    createdAt: now,
  };
  const preparations = db.collection<FederationPublicationPreparation>(
    FEDERATION_PUBLICATION_PREPARATIONS_COLLECTION
  );
  await preparations.updateOne({ _id: intended._id }, { $setOnInsert: intended }, { upsert: true });
  const stored = await preparations.findOne({ _id: intended._id });
  if (
    !stored ||
    stored.applicationId !== intended.applicationId ||
    stored.status !== "prepared" ||
    stored.effectsHash !== intended.effectsHash ||
    JSON.stringify(stored.effectIds) !== JSON.stringify(intended.effectIds)
  )
    throw new Error("Federation publication key conflicts with another plan");
  const collection = db.collection<FederationPreparedEffect>(
    FEDERATION_PREPARED_EFFECTS_COLLECTION
  );
  for (const effect of effects) {
    await collection.updateOne({ _id: effect._id }, { $setOnInsert: effect }, { upsert: true });
    const saved = await collection.findOne({ _id: effect._id });
    if (
      !saved ||
      saved.applicationId !== effect.applicationId ||
      saved.kind !== effect.kind ||
      saved.key !== effect.key ||
      saved.valueHash !== effect.valueHash ||
      hashSettlementPayload(saved.value) !== effect.valueHash
    )
      throw new Error("Federation prepared effect conflicts with its approved plan");
  }
  return stored;
}

/** The final writer calls this before any effective step or receipt. */
export async function verifyPreparedFederationPublication(
  db: Db,
  applicationId: string
): Promise<FederationPreparedEffect[]> {
  const preparation = await db
    .collection<FederationPublicationPreparation>(FEDERATION_PUBLICATION_PREPARATIONS_COLLECTION)
    .findOne({ _id: applicationId, status: "prepared" });
  if (!preparation) throw new Error("Federation publication has no prepared inventory");
  const effects = await db
    .collection<FederationPreparedEffect>(FEDERATION_PREPARED_EFFECTS_COLLECTION)
    .find({ applicationId })
    .toArray();
  effects.sort((a, b) => a._id.localeCompare(b._id));
  if (
    effects.length !== preparation.effectIds.length ||
    JSON.stringify(effects.map((effect) => effect._id)) !== JSON.stringify(preparation.effectIds) ||
    effects.some(
      (effect) =>
        effect.applicationId !== applicationId ||
        effect._id !== `${applicationId}:${effect.kind}:${effect.key}` ||
        hashSettlementPayload(effect.value) !== effect.valueHash
    ) ||
    hashSettlementPayload(effects.map(({ _id, valueHash }) => [_id, valueHash])) !==
      preparation.effectsHash
  )
    throw new Error("Federation prepared inventory is incomplete or altered");
  return effects;
}
