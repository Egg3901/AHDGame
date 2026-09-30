import { createHash } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PlayableResidence } from "./rules/residency";
import { planSuccessionResidency } from "./rules/residency";
import { planPrivateFirmSuccession } from "./rules/privateFacilities";
import { planSuccessionFiscalShares } from "./rules/fiscalShares";
import type { SuccessionApprovalInput } from "./rules/decision";
import { loadPersistedFederationApproval } from "./ratificationStore";
import { stageFederationFacilityClaims } from "./facilityClaimLedger";
import { loadLiveSuccessionResidents } from "./loadLiveResidents";
import { loadLivePrivateSuccessionFirms } from "./loadLivePrivateFirms";
import { planLiveSuccessionActivation, type SuccessionActivationInput } from "./planActivation";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  type FederationSettlementApplicationRecord,
} from "./runtimeEntities";

export const FEDERATION_SETTLEMENT_INTENTS_COLLECTION = "federationSettlementIntents";

type LiveActivationInput = Omit<SuccessionActivationInput, "sourceRegions" | "custodyAssets">;

export interface FederationSettlementIntentRecord {
  _id: string;
  presetId: string;
  settlementId: string;
  revision: number;
  sourceEntityId: string;
  appliedOnTurn: number;
  status: "staged";
  /** SHA-256 of the full preflight, including live balances and private claims. */
  payloadHash: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface LiveSettlementSnapshot {
  payload: Record<string, unknown>;
  payloadHash: string;
  activationPlan: Awaited<ReturnType<typeof planLiveSuccessionActivation>>;
  residencePlans: ReturnType<typeof planSuccessionResidency>;
  privateFirmPlans: ReturnType<typeof planPrivateFirmSuccession>;
  fiscalShares: ReturnType<typeof planSuccessionFiscalShares>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  return value;
}

export function hashSettlementPayload(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/** Terms requiring political consent, excluding live cash amounts that can
 * change while the normal parliamentary vote is open. */
export function federationPoliticalTermsFromActivation(activation: LiveActivationInput) {
  return {
    presetId: activation.source.presetId,
    sourceEntityId: activation.source.entityId,
    settlementId: activation.settlementId,
    revision: activation.approval.revision,
    participants: [...activation.approval.requiredParticipants].sort(),
    territories: activation.territories
      .map((territory) => ({
        entityId: territory.entityId,
        regionIds: [...territory.regionIds].sort(),
      }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId)),
    successors: activation.successors
      .map((entry) => ({ entityId: entry.entityId, displayName: entry.displayName }))
      .sort((a, b) => a.entityId.localeCompare(b.entityId)),
    continuingDisplayName: activation.continuingDisplayName,
    negotiatedCustodians: activation.negotiatedCustodians,
    assetBasis: activation.finances.assetBasis,
    debtBasis: activation.finances.debtBasis,
    // A population default is a rule, not a frozen census. Negotiated basis
    // instead binds the exact basis-point shares approved by the participants.
    assetWeights:
      activation.finances.assetBasis === "population" ? {} : activation.finances.assetWeights,
    debtWeights:
      activation.finances.debtBasis === "population" ? {} : activation.finances.debtWeights,
  };
}

export type FederationPoliticalTerms = ReturnType<typeof federationPoliticalTermsFromActivation>;

export function hashFederationPoliticalTerms(activation: LiveActivationInput): string {
  return hashSettlementPayload(federationPoliticalTermsFromActivation(activation));
}

function sameApproval(a: SuccessionApprovalInput, b: SuccessionApprovalInput): boolean {
  const normalized = (input: SuccessionApprovalInput) => ({
    ...input,
    requiredParticipants: [...input.requiredParticipants].sort(),
    consents: [...input.consents].sort((x, y) => x.entityId.localeCompare(y.entityId)),
  });
  return hashSettlementPayload(normalized(a)) === hashSettlementPayload(normalized(b));
}

/** Rebuild the whole proposed settlement from one database snapshot. The
 * application writer must compare this hash under its turn transaction before
 * making any effective change. */
export async function buildLiveFederationSettlementSnapshot(input: {
  db: Db;
  sourceCountryId: CountryId;
  activation: LiveActivationInput;
  currentYear: number;
  eraUnitScale: number;
  playableResidences: readonly PlayableResidence[];
  residenceChoices: Readonly<Record<string, PlayableResidence>>;
  playableHeadquarters: readonly PlayableResidence[];
  headquartersChoices: Readonly<Record<string, PlayableResidence>>;
  session?: ClientSession;
}): Promise<LiveSettlementSnapshot> {
  const { db, sourceCountryId, activation, currentYear, eraUnitScale, session } = input;
  if (!Number.isSafeInteger(currentYear) || !Number.isFinite(eraUnitScale) || eraUnitScale <= 0)
    throw new Error("Federation snapshot needs a valid valuation year and unit scale");
  const plan = await planLiveSuccessionActivation(db, sourceCountryId, activation, session);
  const residents = await loadLiveSuccessionResidents(db, sourceCountryId, session);
  const residencePlans = planSuccessionResidency({
    sourceCountryId,
    territories: activation.territories,
    residents,
    playableResidences: input.playableResidences,
    choices: input.residenceChoices,
  });
  const firms = await loadLivePrivateSuccessionFirms(
    db,
    sourceCountryId,
    currentYear,
    eraUnitScale,
    session
  );
  const privateFirmPlans = planPrivateFirmSuccession({
    settlementId: activation.settlementId,
    sourceCountryId,
    territories: activation.territories,
    firms,
    playableHeadquarters: input.playableHeadquarters,
    choices: input.headquartersChoices,
  });
  const fiscalShares = planSuccessionFiscalShares({
    finances: activation.finances,
    privateFirms: privateFirmPlans,
  });
  const payload = canonical({
    valuation: { currentYear, eraUnitScale },
    choices: {
      playableResidences: input.playableResidences,
      residenceChoices: input.residenceChoices,
      playableHeadquarters: input.playableHeadquarters,
      headquartersChoices: input.headquartersChoices,
    },
    activation: { ...activation, now: undefined },
    plan: {
      ...plan,
      macroCountries: plan.macroCountries.map(({ createdAt, updatedAt, ...country }) => country),
    },
    residents,
    residencePlans,
    firms,
    privateFirmPlans,
    fiscalShares,
  }) as Record<string, unknown>;
  return {
    payload,
    payloadHash: hashSettlementPayload(payload),
    activationPlan: plan,
    residencePlans,
    privateFirmPlans,
    fiscalShares,
  };
}

/** A settlement application must call this with the same Mongo session used
 * for its writes. It rejects stale or altered intents before any mutation. */
export async function verifyLiveFederationSettlementIntent(input: {
  db: Db;
  intentId: string;
  sourceCountryId: CountryId;
  appliedOnTurn: number;
  session?: ClientSession;
}): Promise<{ intent: FederationSettlementIntentRecord; snapshot: LiveSettlementSnapshot }> {
  const { db, intentId, sourceCountryId, appliedOnTurn, session } = input;
  const intent = await db
    .collection<FederationSettlementIntentRecord>(FEDERATION_SETTLEMENT_INTENTS_COLLECTION)
    .findOne({ _id: intentId, status: "staged" }, { session });
  if (
    !intent ||
    intent.presetId !== "1991-default" ||
    intent.sourceEntityId !== sourceCountryId ||
    intent.appliedOnTurn !== appliedOnTurn ||
    !Number.isSafeInteger(appliedOnTurn) ||
    appliedOnTurn < 1 ||
    !(intent.createdAt instanceof Date) ||
    !Number.isFinite(intent.createdAt.getTime()) ||
    !isRecord(intent.payload) ||
    hashSettlementPayload(intent.payload) !== intent.payloadHash
  )
    throw new Error("Federation intent is missing, altered or on another turn");
  const { activation, valuation, choices } = intent.payload;
  if (
    !isRecord(activation) ||
    !isRecord(valuation) ||
    !isRecord(choices) ||
    !Array.isArray(choices.playableResidences) ||
    !Array.isArray(choices.playableHeadquarters) ||
    !isRecord(choices.residenceChoices) ||
    !isRecord(choices.headquartersChoices) ||
    activation.settlementId !== intent.settlementId ||
    !isRecord(activation.approval) ||
    activation.approval.revision !== intent.revision ||
    activation.approval.currentYear !== valuation.currentYear
  )
    throw new Error("Federation intent lacks reproducible approved terms");
  const ratified = await loadPersistedFederationApproval({
    db,
    sourceEntityId: sourceCountryId,
    approval: activation.approval as unknown as LiveActivationInput["approval"],
    termsHash: hashFederationPoliticalTerms({
      ...activation,
      now: intent.createdAt,
    } as unknown as LiveActivationInput),
    appliedOnTurn,
    session,
  });
  if (!sameApproval(ratified, activation.approval as unknown as SuccessionApprovalInput))
    throw new Error("Federation intent approval differs from recorded votes");
  const fresh = await buildLiveFederationSettlementSnapshot({
    db,
    sourceCountryId,
    activation: { ...activation, now: intent.createdAt } as unknown as LiveActivationInput,
    currentYear: valuation.currentYear as number,
    eraUnitScale: valuation.eraUnitScale as number,
    playableResidences: choices.playableResidences as PlayableResidence[],
    residenceChoices: choices.residenceChoices as Record<string, PlayableResidence>,
    playableHeadquarters: choices.playableHeadquarters as PlayableResidence[],
    headquartersChoices: choices.headquartersChoices as Record<string, PlayableResidence>,
    session,
  });
  if (fresh.payloadHash !== intent.payloadHash)
    throw new Error("Federation source changed since settlement approval");
  return { intent, snapshot: fresh };
}

/** Freeze an approved, live-derived settlement as a contingent intent. This
 * stage moves no money or sovereignty. A later writer must refresh the source
 * under its turn lock before applying any of these frozen terms. */
export async function stageLiveFederationSettlementIntent(input: {
  db: Db;
  sourceCountryId: CountryId;
  activation: LiveActivationInput;
  appliedOnTurn: number;
  currentYear: number;
  eraUnitScale: number;
  playableResidences: readonly PlayableResidence[];
  residenceChoices: Readonly<Record<string, PlayableResidence>>;
  playableHeadquarters: readonly PlayableResidence[];
  headquartersChoices: Readonly<Record<string, PlayableResidence>>;
}): Promise<FederationSettlementIntentRecord> {
  const { db, sourceCountryId, activation, appliedOnTurn, currentYear } = input;
  const presetId = activation.source.presetId;
  const revision = activation.approval.revision;
  if (
    presetId !== "1991-default" ||
    !Number.isSafeInteger(appliedOnTurn) ||
    appliedOnTurn < 1 ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    currentYear !== activation.approval.currentYear ||
    !Number.isFinite(activation.now.getTime()) ||
    Object.values(activation.macroTerms).some((terms) => terms.currentTurn !== appliedOnTurn)
  )
    throw new Error("Federation intent needs a valid 1991 turn and approved revision");
  const applied = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ presetId, sourceEntityId: sourceCountryId, status: "applied" });
  if (applied) throw new Error("Federation source already has an applied settlement");

  const ratified = await loadPersistedFederationApproval({
    db,
    sourceEntityId: sourceCountryId,
    approval: activation.approval,
    termsHash: hashFederationPoliticalTerms(activation),
    appliedOnTurn,
  });
  if (!sameApproval(ratified, activation.approval))
    throw new Error("Federation proposal approval differs from recorded votes");

  const { payload, payloadHash, privateFirmPlans } = await buildLiveFederationSettlementSnapshot({
    ...input,
    db,
    sourceCountryId,
    activation,
  });
  const _id = `${presetId}:${activation.settlementId}:${revision}`;
  const intended: FederationSettlementIntentRecord = {
    _id,
    presetId,
    settlementId: activation.settlementId,
    revision,
    sourceEntityId: sourceCountryId,
    appliedOnTurn,
    status: "staged",
    payloadHash,
    payload,
    createdAt: activation.now,
  };
  const collection = db.collection<FederationSettlementIntentRecord>(
    FEDERATION_SETTLEMENT_INTENTS_COLLECTION
  );
  await collection.updateOne({ _id }, { $setOnInsert: intended }, { upsert: true });
  const stored = await collection.findOne({ _id });
  if (
    !stored ||
    stored.presetId !== presetId ||
    stored.settlementId !== activation.settlementId ||
    stored.revision !== revision ||
    stored.sourceEntityId !== sourceCountryId ||
    stored.appliedOnTurn !== appliedOnTurn ||
    stored.status !== "staged" ||
    stored.payloadHash !== payloadHash ||
    hashSettlementPayload(stored.payload) !== payloadHash
  )
    throw new Error("Federation intent key conflicts with another settlement proposal");
  await stageFederationFacilityClaims(db, _id, privateFirmPlans, activation.now);
  return stored;
}
