import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import type { SuccessionCustodyAssignment } from "./rules/custody";
import type { FederationStateTransferPlan } from "./territoryTransferPlan";
import {
  FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION,
  type FederationArchivedRegionRow,
} from "./materializeTerritory";
import {
  FEDERATION_ARCHIVED_PUBLIC_CORPORATIONS_COLLECTION,
  type FederationArchivedPublicCorporation,
} from "./materializePublicCorporations";

export const FEDERATION_CUSTODY_RECORDS_COLLECTION = "federationCustodyRecords";

export interface FederationCustodyRecord {
  _id: string;
  applicationId: string;
  assignment: SuccessionCustodyAssignment;
  /** Original unit or enterprise shell. Facility originals live in the region archive. */
  sourceDocument?: MilitaryUnit | Corporation;
}

function objectIdFromAsset(assetId: string, prefix: string): ObjectId {
  const value = assetId.slice(prefix.length);
  if (!assetId.startsWith(prefix) || !/^[a-f\d]{24}$/i.test(value))
    throw new Error("Federation custody asset has an invalid source ID");
  return new ObjectId(value);
}

/** Apply physical custody after departed regional rows have been archived, in
 * the same transaction. A background unit or shell leaves the detailed source;
 * a retained force must still be stationed in surviving detailed territory. */
export async function materializeFederationCustody(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  sourceCountryId: CountryId;
  assignments: readonly SuccessionCustodyAssignment[];
  transfers: readonly FederationStateTransferPlan[];
}): Promise<number> {
  const { db, session, applicationId, sourceCountryId, assignments, transfers } = input;
  const transferByState = new Map(transfers.map((row) => [row.stateId, row]));
  if (
    !applicationId ||
    transfers.length === 0 ||
    transferByState.size !== transfers.length ||
    new Set(assignments.map((assignment) => assignment.assetId)).size !== assignments.length
  )
    throw new Error("Federation custody needs a complete approved inventory");
  const records: FederationCustodyRecord[] = [];
  for (const assignment of assignments) {
    if (
      assignment.disposition !==
      (assignment.custodianEntityId === sourceCountryId
        ? "retain-detailed"
        : "aggregate-background")
    )
      throw new Error("Federation custody disposition disagrees with its custodian");
    let sourceDocument: MilitaryUnit | Corporation | undefined;
    if (assignment.assetId.startsWith("force:")) {
      if (assignment.kind !== "conventional-force" && assignment.kind !== "strategic-force")
        throw new Error("Federation custody force has an invalid kind");
      const unitId = objectIdFromAsset(assignment.assetId, "force:");
      const units = db.collection<MilitaryUnit>("militaryUnits");
      const unit = await units.findOne({ _id: unitId, countryId: sourceCountryId }, { session });
      if (!unit) throw new Error("Federation custody force is missing");
      const transfer = unit.station ? transferByState.get(unit.station) : undefined;
      if (
        (assignment.kind === "strategic-force") !==
        (unit.domain === "rocket" || unit.domain === "space")
      )
        throw new Error("Federation custody force changed location or kind");
      if (assignment.disposition === "retain-detailed") {
        if (!transfer || transfer.leavesDetailedSource)
          throw new Error("Retained federation force needs an approved playable station");
      } else {
        if (
          assignment.kind === "conventional-force" &&
          transfer &&
          transfer.successorEntityId !== assignment.custodianEntityId
        )
          throw new Error("Conventional federation force must follow its station");
        sourceDocument = unit;
        const removed = await units.deleteOne(
          { _id: unitId, countryId: sourceCountryId },
          { session }
        );
        if (removed.deletedCount !== 1) throw new Error("Federation custody force changed");
      }
    } else if (assignment.assetId.startsWith("enterprise-shell:")) {
      if (assignment.kind !== "public-enterprise")
        throw new Error("Federation custody enterprise shell has an invalid kind");
      const corporationId = objectIdFromAsset(assignment.assetId, "enterprise-shell:");
      const corporations = db.collection<Corporation>("corporations");
      const corporation = await corporations.findOne({ _id: corporationId }, { session });
      const archived = await db
        .collection<FederationArchivedPublicCorporation>(
          FEDERATION_ARCHIVED_PUBLIC_CORPORATIONS_COLLECTION
        )
        .findOne(
          { _id: `${applicationId}:${corporationId.toString()}`, applicationId },
          { session }
        );
      if (archived && corporation)
        throw new Error("Federation public shell exists in both detailed and archived custody");
      const shell = corporation ?? archived?.value;
      if (
        !shell ||
        !isStateOwned(shell) ||
        (shell.countryOwnerId ?? shell.countryId) !== sourceCountryId ||
        (await db
          .collection<CorporateSector>("corporateSectors")
          .countDocuments({ corporationId }, { session })) !== 0 ||
        (archived &&
          (assignment.disposition !== "aggregate-background" ||
            !archived.custodians.includes(assignment.custodianEntityId)))
      )
        throw new Error("Federation custody enterprise shell changed");
      if (assignment.disposition === "aggregate-background") {
        sourceDocument = shell;
        if (corporation) {
          const removed = await corporations.deleteOne({ _id: corporationId }, { session });
          if (removed.deletedCount !== 1) throw new Error("Federation custody enterprise changed");
        }
      }
    } else if (assignment.assetId.startsWith("enterprise:")) {
      if (assignment.kind !== "public-enterprise")
        throw new Error("Federation custody enterprise has an invalid kind");
      const sectorId = objectIdFromAsset(assignment.assetId, "enterprise:");
      if (assignment.disposition === "aggregate-background") {
        const archived = await db
          .collection<FederationArchivedRegionRow>(FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION)
          .findOne(
            {
              _id: `${applicationId}:corporateSectors:${sectorId.toString()}`,
              applicationId,
              collection: "corporateSectors",
              successorEntityId: assignment.custodianEntityId,
            },
            { session }
          );
        if (!archived) throw new Error("Federation custody enterprise facility was not archived");
      } else {
        const sector = await db
          .collection<CorporateSector>("corporateSectors")
          .findOne({ _id: sectorId, countryId: sourceCountryId }, { session });
        if (!sector || transferByState.get(sector.stateId)?.leavesDetailedSource !== false)
          throw new Error("Retained federation enterprise has no playable facility");
      }
    } else {
      throw new Error("Federation custody has an unknown asset type");
    }
    records.push({
      _id: `${applicationId}:${assignment.assetId}`,
      applicationId,
      assignment,
      ...(sourceDocument ? { sourceDocument } : {}),
    });
  }
  if (records.length)
    await db
      .collection<FederationCustodyRecord>(FEDERATION_CUSTODY_RECORDS_COLLECTION)
      .insertMany(records, {
        session,
      });
  return records.length;
}
