import { ObjectId, type ClientSession, type Db } from "mongodb";
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
  const planByFirm = new Map(plans.map((plan) => [plan.corporationId, plan]));
  const transferByState = new Map(transfers.map((transfer) => [transfer.stateId, transfer]));
  if (
    !applicationId ||
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
    const corporations = db.collection<Corporation>("corporations");
    const corporation = await corporations.findOne({ _id: id }, { session });
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
      const archived = await db
        .collection<FederationArchivedRegionRow>(FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION)
        .findOne(
          {
            _id: `${applicationId}:corporateSectors:${claim.sectorId}`,
            applicationId,
            successorEntityId: claim.debtorEntityId,
          },
          { session }
        );
      const staged = await db
        .collection<FederationFacilityClaimRecord>(FEDERATION_FACILITY_CLAIMS_COLLECTION)
        .findOne({ _id: `${applicationId}:${claim.claimId}`, applicationId }, { session });
      if (
        !archived ||
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
    await db
      .collection<FederationPrivateFirmHold>(FEDERATION_PRIVATE_FIRM_HOLDS_COLLECTION)
      .insertOne(
        {
          _id: `${applicationId}:${firm.corporationId}`,
          applicationId,
          corporationId: firm.corporationId,
          formerCountryId: sourceCountryId,
          formerHeadquartersState: firm.headquartersState,
          successorEntityId: transfer.successorEntityId,
          wasSuspended,
          ...(plan.destination ? { selectedDestination: plan.destination } : {}),
        },
        { session }
      );
    const updated = await corporations.updateOne(
      {
        _id: id,
        countryId: sourceCountryId,
        headquartersState: firm.headquartersState,
        federationPendingHeadquartersId: { $exists: false },
      },
      { $set: { federationPendingHeadquartersId: applicationId, suspended: true } },
      { session }
    );
    if (updated.matchedCount !== 1)
      throw new Error("Federation player firm changed while entering protected relocation");
  }
  return origins;
}
