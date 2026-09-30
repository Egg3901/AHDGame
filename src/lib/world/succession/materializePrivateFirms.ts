/**
 * Federation succession preserves private firms and their financial accounts.
 * materializeFederationPrivateFirms validates compensation claims in batches,
 * then protects affected headquarters until their owners choose a new home.
 */
import { ObjectId, type AnyBulkWriteOperation, type ClientSession, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types/corporation";
import { isNppOwned } from "@/lib/corporations/nppOwned";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import type { PrivateSuccessionFirm, PrivateFirmSuccessionPlan } from "./rules/privateFacilities";
import type { FederationStateTransferPlan } from "./territoryTransferPlan";
import {
  FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION,
  type FederationArchivedRegionRow,
} from "./materializeTerritory";
import {
  FEDERATION_FACILITY_CLAIMS_COLLECTION,
  type FederationFacilityClaimRecord,
} from "./facilityClaimLedger";

export const FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION = "federationPrivateFirmHolds";

export interface FederationPrivateFirmHold {
  _id: string;
  applicationId: string;
  corporationId: string;
  formerCountryId: CountryId;
  formerHeadquartersState: string;
  successorEntityId: string;
  wasSuspended: boolean;
  selectedDestination?: { countryId: CountryId; stateId: string };
  lockedConversion?: {
    fromCurrency: string | null;
    toCurrency: string;
    fromRate: number;
    toRate: number;
  };
  status?: "pending-choice" | "completed";
  completedAt?: Date;
}

/** Preserve player-owned firms whose headquarters enter a background country.
 * Their identity and financial accounts stay in place while the owner chooses
 * a playable HQ. The core corporation turn skips the held firm and its retained
 * sectors, so an archived home cannot produce phantom output or insolvency. */
export async function materializeFederationPrivateFirms(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  sourceCountryId: CountryId;
  firms: readonly PrivateSuccessionFirm[];
  plans: readonly PrivateFirmSuccessionPlan[];
  transfers: readonly FederationStateTransferPlan[];
}): Promise<
  Record<string, { countryId: CountryId; stateId: string; entityId: string; wasSuspended: boolean }>
> {
  const { db, session, applicationId, sourceCountryId, firms, plans, transfers } = input;
  if (!session.inTransaction())
    throw new Error("Federation firm protection requires an active transaction");
  const planByFirm = new Map(plans.map((plan) => [plan.corporationId, plan]));
  const transferByState = new Map(transfers.map((transfer) => [transfer.stateId, transfer]));
  if (
    !applicationId ||
    plans.length !== firms.length ||
    planByFirm.size !== firms.length ||
    transfers.length === 0 ||
    transferByState.size !== transfers.length ||
    new Set(firms.map((firm) => firm.corporationId)).size !== firms.length
  )
    throw new Error("Federation private firm inventory is incomplete");
  const origins: Record<
    string,
    { countryId: CountryId; stateId: string; entityId: string; wasSuspended: boolean }
  > = {};
  if (firms.some((firm) => !/^[a-f\d]{24}$/i.test(firm.corporationId)))
    throw new Error("Federation private firm plan has an invalid corporation identity");
  if (firms.length === 0) return origins;
  const corporations = db.collection<Corporation>("corporations");
  const live = await corporations
    .find(
      { _id: { $in: firms.map((firm) => new ObjectId(firm.corporationId)) } },
      {
        session,
        projection: {
          countryId: 1,
          headquartersState: 1,
          countryOwnerId: 1,
          ownershipState: 1,
          ceoType: 1,
          caretakerCeo: 1,
          federationPendingHeadquartersId: 1,
          suspended: 1,
        },
      }
    )
    .toArray();
  const corporationById = new Map(live.map((row) => [row._id.toHexString(), row]));
  const claims = plans.flatMap((plan) => plan.claims);
  const archiveIds = claims.map((claim) => `${applicationId}:corporateSectors:${claim.sectorId}`);
  const claimIds = claims.map((claim) => `${applicationId}:${claim.claimId}`);
  if (new Set(archiveIds).size !== archiveIds.length || new Set(claimIds).size !== claimIds.length)
    throw new Error("Federation player facilities have duplicate compensation claims");
  const archivedRows = claims.length
    ? await db
        .collection<FederationArchivedRegionRow>(FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION)
        .find(
          { _id: { $in: archiveIds }, applicationId },
          { session, projection: { successorEntityId: 1, "value.corporationId": 1 } }
        )
        .toArray()
    : [];
  const stagedRows = claims.length
    ? await db
        .collection<FederationFacilityClaimRecord>(FEDERATION_FACILITY_CLAIMS_COLLECTION)
        .find(
          { _id: { $in: claimIds }, applicationId },
          { session, projection: { corporationId: 1, amountAnchor: 1, status: 1 } }
        )
        .toArray()
    : [];
  const archiveById = new Map(archivedRows.map((row) => [row._id, row]));
  const claimById = new Map(stagedRows.map((row) => [row._id, row]));
  const holds: FederationPrivateFirmHold[] = [];
  const updates: AnyBulkWriteOperation<Corporation>[] = [];
  for (const firm of firms) {
    const plan = planByFirm.get(firm.corporationId);
    const transfer = transferByState.get(firm.headquartersState);
    if (
      !plan ||
      !transfer ||
      firm.countryId !== sourceCountryId ||
      transfer.topLevelRegionId !== firm.headquartersRegionId ||
      (plan.status === "continuing") !== !transfer.leavesDetailedSource ||
      !/^[a-f\d]{24}$/i.test(firm.corporationId)
    )
      throw new Error("Federation private firm plan disagrees with live headquarters");
    const id = new ObjectId(firm.corporationId);
    const corporation = corporationById.get(id.toHexString());
    if (
      !corporation ||
      corporation.countryId !== sourceCountryId ||
      corporation.headquartersState !== firm.headquartersState ||
      isStateOwned(corporation) ||
      isNppOwned(corporation) ||
      corporation.federationPendingHeadquartersId
    )
      throw new Error("Federation player firm changed before settlement");
    for (const claim of plan.claims) {
      const archived = archiveById.get(`${applicationId}:corporateSectors:${claim.sectorId}`);
      const staged = claimById.get(`${applicationId}:${claim.claimId}`);
      if (
        !archived ||
        archived.successorEntityId !== claim.debtorEntityId ||
        String(archived.value.corporationId) !== firm.corporationId ||
        !staged ||
        staged.status !== "contingent" ||
        staged.corporationId !== firm.corporationId ||
        staged.amountAnchor !== claim.amountAnchor
      )
        throw new Error("Federation player facility lacks an approved compensation claim");
    }
    const wasSuspended = corporation.suspended === true;
    origins[firm.corporationId] = {
      countryId: sourceCountryId,
      stateId: firm.headquartersState,
      entityId: transfer.successorEntityId,
      wasSuspended,
    };
    if (plan.status === "continuing") continue;
    holds.push({
      _id: `${applicationId}:${firm.corporationId}`,
      applicationId,
      corporationId: firm.corporationId,
      formerCountryId: sourceCountryId,
      formerHeadquartersState: firm.headquartersState,
      successorEntityId: transfer.successorEntityId,
      wasSuspended,
      ...(plan.destination ? { selectedDestination: plan.destination } : {}),
      status: "pending-choice",
    });
    updates.push({
      updateOne: {
        filter: {
          _id: id,
          countryId: sourceCountryId,
          headquartersState: firm.headquartersState,
          federationPendingHeadquartersId: { $exists: false },
        },
        update: { $set: { federationPendingHeadquartersId: applicationId, suspended: true } },
      },
    });
  }
  // Validate the complete inventory before writing either the holds or the firms.
  if (holds.length) {
    await db
      .collection<FederationPrivateFirmHold>(FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION)
      .insertMany(holds, { session });
    const updated = await corporations.bulkWrite(updates, { session });
    if (updated.matchedCount !== updates.length)
      throw new Error("Federation player firm changed while entering protected relocation");
  }
  return origins;
}
