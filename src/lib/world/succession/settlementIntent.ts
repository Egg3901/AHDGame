import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PlayableResidence } from "./rules/residency";
import { planSuccessionResidency } from "./rules/residency";
import { planPrivateFirmSuccession } from "./rules/privateFacilities";
import { planSuccessionFiscalShares } from "./rules/fiscalShares";
import { stageFederationFacilityClaims } from "./facilityClaimLedger";
import { loadLiveSuccessionResidents } from "./loadLiveResidents";
import { loadLivePrivateSuccessionFirms } from "./loadLivePrivateFirms";
import { planLiveSuccessionActivation, type SuccessionActivationInput } from "./planActivation";

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

function hashPayload(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
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
  const { db, sourceCountryId, activation, appliedOnTurn, currentYear, eraUnitScale } = input;
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

  const plan = await planLiveSuccessionActivation(db, sourceCountryId, activation);
  const residents = await loadLiveSuccessionResidents(db, sourceCountryId);
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
    eraUnitScale
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
  const payloadHash = hashPayload(payload);
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
    hashPayload(stored.payload) !== payloadHash
  )
    throw new Error("Federation intent key conflicts with another settlement proposal");
  await stageFederationFacilityClaims(db, _id, privateFirmPlans, activation.now);
  return stored;
}
