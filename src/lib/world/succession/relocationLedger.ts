import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PlayableResidence, SuccessionResidencePlan } from "./rules/residency";
import type { PrivateFirmSuccessionPlan } from "./rules/privateFacilities";
import {
  FEDERATION_FACILITY_CLAIMS_COLLECTION,
  type FederationFacilityClaimRecord,
} from "./facilityClaimLedger";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  WORLD_ENTITY_STATES_COLLECTION,
  type FederationSettlementApplicationRecord,
  type RuntimeWorldEntityState,
  validateAppliedEntityStates,
} from "./runtimeEntities";

export const FEDERATION_RELOCATIONS_COLLECTION = "federationRelocations";

export interface FederationRelocationRecord {
  _id: string;
  applicationId: string;
  kind: "resident" | "firm";
  subjectId: string;
  successorEntityId: string;
  formerCountryId: CountryId;
  formerState: string;
  status: "pending-choice" | "selected";
  destination?: PlayableResidence;
  claimIds: string[];
  /** Restore the firm's prior operating state after its headquarters choice. */
  wasSuspended?: boolean;
  createdAt: Date;
}

/** Persist protected owner choices after the whole sovereignty receipt exists.
 * The old country and location remain available for display and audit; a
 * pending record never selects a playable country on the owner's behalf. */
export async function publishFederationRelocations(input: {
  db: Db;
  applicationId: string;
  residents: readonly SuccessionResidencePlan[];
  firms: readonly PrivateFirmSuccessionPlan[];
  firmOrigins: Readonly<
    Record<
      string,
      { countryId: CountryId; stateId: string; entityId: string; wasSuspended?: boolean }
    >
  >;
  now: Date;
  session?: ClientSession;
}): Promise<FederationRelocationRecord[]> {
  const { db, applicationId, residents, firms, firmOrigins, now, session } = input;
  if (!applicationId.trim() || !Number.isFinite(now.getTime()))
    throw new Error("Federation relocation needs an application and time");
  const application = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ _id: applicationId, status: "applied" }, { session });
  if (!application) throw new Error("Federation relocation awaits its applied settlement");
  const states = await db
    .collection<RuntimeWorldEntityState>(WORLD_ENTITY_STATES_COLLECTION)
    .find({ applicationId }, { session })
    .toArray();
  validateAppliedEntityStates(application.presetId, [application], states);

  const records: FederationRelocationRecord[] = residents.map((plan) => ({
    _id: `${applicationId}:resident:${plan.characterId}`,
    applicationId,
    kind: "resident",
    subjectId: plan.characterId,
    successorEntityId: plan.successorEntityId,
    formerCountryId: plan.formerCountryId,
    formerState: plan.formerHomeState,
    status: plan.status,
    ...(plan.status === "selected" ? { destination: plan.destination } : {}),
    claimIds: [],
    createdAt: now,
  }));
  for (const plan of firms) {
    if (plan.status === "continuing") continue;
    const origin = firmOrigins[plan.corporationId];
    if (!origin || origin.countryId !== application.sourceEntityId)
      throw new Error("Federation firm relocation has no source headquarters");
    records.push({
      _id: `${applicationId}:firm:${plan.corporationId}`,
      applicationId,
      kind: "firm",
      subjectId: plan.corporationId,
      successorEntityId: origin.entityId,
      formerCountryId: origin.countryId,
      formerState: origin.stateId,
      status: plan.status === "relocating" ? "selected" : "pending-choice",
      ...(plan.destination ? { destination: plan.destination } : {}),
      claimIds: plan.claims.map((claim) => claim.claimId).sort(),
      ...(origin.wasSuspended !== undefined ? { wasSuspended: origin.wasSuspended } : {}),
      createdAt: now,
    });
  }
  if (new Set(records.map((record) => record._id)).size !== records.length)
    throw new Error("Federation relocation contains duplicate subjects");
  const expectedClaims = firms.flatMap((plan) => plan.claims);
  if (expectedClaims.length) {
    const storedClaims = await db
      .collection<FederationFacilityClaimRecord>(FEDERATION_FACILITY_CLAIMS_COLLECTION)
      .find({ applicationId }, { session })
      .toArray();
    const byId = new Map(storedClaims.map((claim) => [claim.claimId, claim]));
    if (
      storedClaims.length !== expectedClaims.length ||
      expectedClaims.some((claim) => {
        const stored = byId.get(claim.claimId);
        return (
          !stored ||
          stored.corporationId !== claim.corporationId ||
          stored.debtorEntityId !== claim.debtorEntityId ||
          stored.amountAnchor !== claim.amountAnchor
        );
      })
    )
      throw new Error("Federation relocation has missing or changed facility claims");
  }
  const collection = db.collection<FederationRelocationRecord>(FEDERATION_RELOCATIONS_COLLECTION);
  const saved: FederationRelocationRecord[] = [];
  for (const intended of records) {
    await collection.updateOne(
      { _id: intended._id },
      { $setOnInsert: intended },
      { upsert: true, session }
    );
    const stored = await collection.findOne({ _id: intended._id }, { session });
    if (
      !stored ||
      stored.applicationId !== applicationId ||
      stored.kind !== intended.kind ||
      stored.subjectId !== intended.subjectId ||
      stored.successorEntityId !== intended.successorEntityId ||
      stored.formerCountryId !== intended.formerCountryId ||
      stored.formerState !== intended.formerState ||
      JSON.stringify(stored.claimIds) !== JSON.stringify(intended.claimIds) ||
      stored.wasSuspended !== intended.wasSuspended ||
      (intended.status === "selected" && stored.status !== "selected") ||
      (stored.status === "selected" &&
        intended.destination &&
        JSON.stringify(stored.destination) !== JSON.stringify(intended.destination))
    )
      throw new Error("Federation relocation conflicts with an earlier record");
    saved.push(stored);
  }
  return saved;
}
