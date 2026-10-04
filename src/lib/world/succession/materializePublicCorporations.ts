import type { ClientSession, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import type { SuccessionCustodyAssignment } from "./rules/custody";
import type { FederationStateTransferPlan } from "./territoryTransferPlan";
import {
  FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION,
  type FederationArchivedRegionRow,
} from "./materializeTerritory";

export const FEDERATION_ARCHIVED_PUBLIC_CORPORATIONS_COLLECTION =
  "federationArchivedPublicCorporations";
export const FEDERATION_PUBLIC_CORPORATION_REBASES_COLLECTION =
  "federationPublicCorporationRebases";

export interface FederationArchivedPublicCorporation {
  _id: string;
  applicationId: string;
  corporationId: string;
  custodians: string[];
  value: Corporation;
}

export interface FederationPublicCorporationRebase {
  _id: string;
  applicationId: string;
  corporationId: string;
  formerHeadquartersState: string;
  headquartersState: string;
}

/** Complete public-enterprise custody after regional facilities are archived.
 * An empty shell follows its approved background custodians into the archive;
 * a company retaining source facilities keeps operating from a surviving site. */
export async function materializeFederationPublicCorporations(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  sourceCountryId: CountryId;
  transfers: readonly FederationStateTransferPlan[];
  assignments: readonly SuccessionCustodyAssignment[];
}): Promise<{ archived: number; rebased: number }> {
  const { db, session, applicationId, sourceCountryId, transfers, assignments } = input;
  const transferByState = new Map(transfers.map((row) => [row.stateId, row]));
  const custodyByAsset = new Map(assignments.map((row) => [row.assetId, row]));
  if (
    !applicationId ||
    transfers.length === 0 ||
    transferByState.size !== transfers.length ||
    custodyByAsset.size !== assignments.length
  )
    throw new Error("Federation public corporations need approved custody and territory");
  const corporations = await db
    .collection<Corporation>("corporations")
    .find(
      {
        $or: [
          { countryOwnerId: sourceCountryId },
          { countryId: sourceCountryId, ownershipState: "stateOwned" },
        ],
      },
      { session }
    )
    .toArray();
  const publicCorporations = corporations.filter(
    (corp) => isStateOwned(corp) && (corp.countryOwnerId ?? corp.countryId) === sourceCountryId
  );
  const corporationIds = publicCorporations.map((corp) => corp._id);
  const sectors = corporationIds.length
    ? await db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: { $in: corporationIds } }, { session })
        .toArray()
    : [];
  const activeByCorporation = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    const key = sector.corporationId.toString();
    activeByCorporation.set(key, [...(activeByCorporation.get(key) ?? []), sector]);
  }
  const archivedSectors = await db
    .collection<FederationArchivedRegionRow>(FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION)
    .find({ applicationId, collection: "corporateSectors" }, { session })
    .toArray();
  const archivedByCorporation = new Map<string, FederationArchivedRegionRow[]>();
  for (const row of archivedSectors) {
    const corporationId = row.value.corporationId;
    if (corporationId == null) continue;
    const key = String(corporationId);
    archivedByCorporation.set(key, [...(archivedByCorporation.get(key) ?? []), row]);
  }
  let archived = 0;
  let rebased = 0;
  for (const corporation of publicCorporations) {
    const corporationId = corporation._id.toString();
    const active = activeByCorporation.get(corporationId) ?? [];
    const formerHeadquarters = transferByState.get(corporation.headquartersState);
    if (!formerHeadquarters)
      throw new Error("Federation public corporation headquarters changed before settlement");
    const transferred = archivedByCorporation.get(corporationId) ?? [];
    const custodians = transferred.map((row) => {
      const assignment = custodyByAsset.get(`enterprise:${row.originalId}`);
      if (
        !assignment ||
        assignment.kind !== "public-enterprise" ||
        assignment.disposition !== "aggregate-background" ||
        assignment.custodianEntityId !== row.successorEntityId
      )
        throw new Error("Federation public facility lacks approved background custody");
      return assignment.custodianEntityId;
    });
    const shell = custodyByAsset.get(`enterprise-shell:${corporationId}`);
    if (active.length === 0 && shell?.disposition !== "retain-detailed") {
      if (transferred.length === 0 && shell?.disposition !== "aggregate-background")
        throw new Error("Federation public corporation has no approved successor assets");
      if (shell) custodians.push(shell.custodianEntityId);
      await db
        .collection<FederationArchivedPublicCorporation>(
          FEDERATION_ARCHIVED_PUBLIC_CORPORATIONS_COLLECTION
        )
        .insertOne(
          {
            _id: `${applicationId}:${corporationId}`,
            applicationId,
            corporationId,
            custodians: [...new Set(custodians)].sort(),
            value: corporation,
          },
          { session }
        );
      const removed = await db
        .collection<Corporation>("corporations")
        .deleteOne({ _id: corporation._id }, { session });
      if (removed.deletedCount !== 1)
        throw new Error("Federation public corporation changed during archive");
      archived++;
      continue;
    }
    if (!formerHeadquarters.leavesDetailedSource) continue;
    const retained = active
      .map((sector) => sector.stateId)
      .filter((stateId) => transferByState.get(stateId)?.leavesDetailedSource === false)
      .sort();
    if (shell?.disposition === "retain-detailed" && retained.length === 0)
      retained.push(
        ...transfers
          .filter((row) => !row.leavesDetailedSource)
          .map((row) => row.stateId)
          .sort()
      );
    if (retained.length === 0)
      throw new Error("Retained federation enterprise needs an approved playable headquarters");
    const headquartersState = retained[0];
    await db
      .collection<FederationPublicCorporationRebase>(
        FEDERATION_PUBLIC_CORPORATION_REBASES_COLLECTION
      )
      .insertOne(
        {
          _id: `${applicationId}:${corporationId}`,
          applicationId,
          corporationId,
          formerHeadquartersState: corporation.headquartersState,
          headquartersState,
        },
        { session }
      );
    const updated = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id, headquartersState: corporation.headquartersState },
        { $set: { headquartersState } },
        { session }
      );
    if (updated.matchedCount !== 1)
      throw new Error("Federation public corporation changed during headquarters rebase");
    rebased++;
  }
  return { archived, rebased };
}
