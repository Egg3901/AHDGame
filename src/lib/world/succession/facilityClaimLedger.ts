import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PrivateFacilityClaim, PrivateFirmSuccessionPlan } from "./rules/privateFacilities";
import {
  FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION,
  WORLD_ENTITY_STATES_COLLECTION,
  type FederationSettlementApplicationRecord,
  type RuntimeWorldEntityState,
  validateAppliedEntityStates,
} from "./runtimeEntities";

export const FEDERATION_FACILITY_CLAIMS_COLLECTION = "federationFacilityClaims";

export interface FederationFacilityClaimRecord extends PrivateFacilityClaim {
  _id: string;
  applicationId: string;
  /** A staged claim cannot pay or enter a firm's balance sheet. */
  status: "contingent" | "payable" | "paid";
  createdAt: Date;
}

/** Persist each proposed claim under a stable application key. A crash can
 * leave a prefix of contingent rows, but retry fills the remainder without
 * doubling liabilities. No money or sovereign status changes in this stage. */
export async function stageFederationFacilityClaims(
  db: Db,
  applicationId: string,
  plans: readonly PrivateFirmSuccessionPlan[],
  now: Date,
  session?: ClientSession
): Promise<FederationFacilityClaimRecord[]> {
  if (!applicationId.trim() || !Number.isFinite(now.getTime()))
    throw new Error("Facility claim staging needs a valid application and time");
  const claims = plans.flatMap((plan) => {
    if (!plan.corporationId || (plan.status === "pending-headquarters" && plan.destination))
      throw new Error("Facility claim staging has an invalid firm plan");
    return plan.claims.map((claim) => {
      if (
        claim.corporationId !== plan.corporationId ||
        !claim.claimId ||
        !claim.sectorId ||
        !claim.debtorEntityId ||
        !Number.isFinite(claim.amountAnchor) ||
        claim.amountAnchor < 0 ||
        (plan.status === "pending-headquarters" && claim.creditorCountryId !== null) ||
        (plan.status !== "pending-headquarters" && !claim.creditorCountryId)
      )
        throw new Error("Facility claim staging has an invalid liability");
      return claim;
    });
  });
  const ids = claims.map((claim) => `${applicationId}:${claim.claimId}`);
  if (new Set(ids).size !== ids.length)
    throw new Error("Facility claim staging has duplicate liabilities");

  const collection = db.collection<FederationFacilityClaimRecord>(
    FEDERATION_FACILITY_CLAIMS_COLLECTION
  );
  if (claims.length === 0) return [];
  const intended = claims.map((claim, index): FederationFacilityClaimRecord => ({
    ...claim,
    _id: ids[index],
    applicationId,
    status: "contingent",
    createdAt: now,
  }));
  await collection.bulkWrite(
    intended.map((record) => ({
      updateOne: { filter: { _id: record._id }, update: { $setOnInsert: record }, upsert: true },
    })),
    { session }
  );
  const saved = await collection.find({ _id: { $in: ids } }, { session }).toArray();
  const savedById = new Map(saved.map((record) => [record._id, record]));
  const records: FederationFacilityClaimRecord[] = [];
  for (let index = 0; index < claims.length; index++) {
    const claim = claims[index];
    const stored = savedById.get(ids[index]);
    if (
      !stored ||
      stored.applicationId !== applicationId ||
      !["contingent", "payable", "paid"].includes(stored.status) ||
      stored.claimId !== claim.claimId ||
      stored.corporationId !== claim.corporationId ||
      stored.sectorId !== claim.sectorId ||
      stored.debtorEntityId !== claim.debtorEntityId ||
      (stored.creditorCountryId !== claim.creditorCountryId &&
        !(
          claim.creditorCountryId === null &&
          stored.creditorCountryId &&
          (stored.status === "payable" || stored.status === "paid")
        )) ||
      stored.amountAnchor !== claim.amountAnchor
    )
      throw new Error("Facility claim key conflicts with an existing liability");
    records.push(stored);
  }
  return records;
}

/** Make one staged claim payable only after the full settlement receipt is
 * published. An explicit playable headquarters choice supplies the creditor
 * country; repeat calls cannot redirect a claim or pay it twice. */
export async function activateFederationFacilityClaim(
  db: Db,
  applicationId: string,
  claimId: string,
  corporationId: string,
  creditorCountryId: CountryId,
  session?: ClientSession
): Promise<FederationFacilityClaimRecord> {
  if (!applicationId.trim() || !claimId.trim() || !corporationId.trim() || !creditorCountryId)
    throw new Error("Facility claim activation needs an application, firm and creditor");
  const application = await db
    .collection<FederationSettlementApplicationRecord>(
      FEDERATION_SETTLEMENT_APPLICATIONS_COLLECTION
    )
    .findOne({ _id: applicationId, status: "applied" }, { session });
  if (!application) throw new Error("Facility claim cannot activate before its settlement");
  const entityStates = await db
    .collection<RuntimeWorldEntityState>(WORLD_ENTITY_STATES_COLLECTION)
    .find({ applicationId }, { session })
    .toArray();
  validateAppliedEntityStates(application.presetId, [application], entityStates);
  const _id = `${applicationId}:${claimId}`;
  const collection = db.collection<FederationFacilityClaimRecord>(
    FEDERATION_FACILITY_CLAIMS_COLLECTION
  );
  const existing = await collection.findOne({ _id }, { session });
  if (
    !existing ||
    existing.applicationId !== applicationId ||
    existing.claimId !== claimId ||
    existing.corporationId !== corporationId ||
    (existing.creditorCountryId !== null && existing.creditorCountryId !== creditorCountryId)
  )
    throw new Error("Facility claim is missing or belongs to another creditor");
  if (existing.status === "contingent") {
    await collection.updateOne(
      {
        _id,
        status: "contingent",
        creditorCountryId: existing.creditorCountryId,
      },
      { $set: { status: "payable", creditorCountryId } },
      { session }
    );
  }
  const result = await collection.findOne({ _id }, { session });
  if (
    !result ||
    (result.status !== "payable" && result.status !== "paid") ||
    result.creditorCountryId !== creditorCountryId ||
    result.corporationId !== corporationId
  )
    throw new Error("Facility claim activation conflicted with another writer");
  return result;
}
