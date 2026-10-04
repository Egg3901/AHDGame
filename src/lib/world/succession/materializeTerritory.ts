import type { ClientSession, Db, Document } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types/state";
import {
  REGION_SCOPED_COLLECTIONS,
  type RegionScope,
} from "@/lib/referendum/transfer/regionScopedCollections";
import type { FederationStateTransferPlan } from "./territoryTransferPlan";

export const FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION = "federationArchivedRegionRows";

export interface FederationArchivedRegionRow {
  _id: string;
  applicationId: string;
  collection: string;
  successorEntityId: string;
  sourceCountryId: CountryId;
  originalId: string;
  value: Document;
}

function scopeFilter(scope: RegionScope, sourceCountryId: CountryId, stateIds: string[]): Document {
  switch (scope.key) {
    case "stateIdField":
      return { stateId: { $in: stateIds } };
    case "stateField":
      return { state: { $in: stateIds } };
    case "idIsState":
      return { _id: { $in: stateIds } };
    case "homeStateField":
      return { homeState: { $in: stateIds } };
    case "compositeCountryState":
      return { _id: { $in: stateIds.map((id) => `${sourceCountryId}_${id}`) } };
  }
}

/** Move a departing region's detailed rows out of active simulation inside the
 * settlement transaction. Characters are deliberately preserved for their
 * protected residence choice; firms and custody assets are handled separately.
 * The archive retains original documents without pretending the background
 * successor has the detailed CountryId required by playable-country systems. */
export async function materializeFederationTerritory(input: {
  db: Db;
  session: ClientSession;
  applicationId: string;
  sourceCountryId: CountryId;
  transfers: readonly FederationStateTransferPlan[];
}): Promise<{ statesArchived: number; regionalRowsArchived: number }> {
  const { db, session, applicationId, sourceCountryId, transfers } = input;
  const departed = transfers.filter((row) => row.leavesDetailedSource);
  const stateIds = departed.map((row) => row.stateId);
  if (
    !applicationId ||
    transfers.length === 0 ||
    new Set(transfers.map((row) => row.stateId)).size !== transfers.length ||
    departed.some((row) => row.successorEntityId === sourceCountryId) ||
    transfers.some(
      (row) => row.leavesDetailedSource !== (row.successorEntityId !== sourceCountryId)
    )
  )
    throw new Error("Federation territory archive needs a complete approved partition");
  if (departed.length === 0) return { statesArchived: 0, regionalRowsArchived: 0 };
  const successorForState = new Map(departed.map((row) => [row.stateId, row.successorEntityId]));
  const archive = db.collection<FederationArchivedRegionRow>(
    FEDERATION_ARCHIVED_REGION_ROWS_COLLECTION
  );
  const archiveRows = async (
    collection: string,
    rows: Document[],
    stateFor: (row: Document) => string
  ) => {
    if (rows.length === 0) return;
    const records = rows.map((row) => {
      const stateId = stateFor(row);
      const successorEntityId = successorForState.get(stateId);
      if (!successorEntityId || row._id == null)
        throw new Error(`Federation ${collection} row is outside approved territory`);
      return {
        _id: `${applicationId}:${collection}:${String(row._id)}`,
        applicationId,
        collection,
        successorEntityId,
        sourceCountryId,
        originalId: String(row._id),
        value: row,
      } satisfies FederationArchivedRegionRow;
    });
    await archive.insertMany(records, { session });
  };

  const states = await db
    .collection<State>("states")
    .find({ _id: { $in: stateIds }, countryId: sourceCountryId }, { session })
    .toArray();
  if (states.length !== departed.length)
    throw new Error("Federation territory changed after approved state inventory");
  await archiveRows("states", states, (row) => String(row._id));

  let regionalRowsArchived = 0;
  for (const scope of REGION_SCOPED_COLLECTIONS) {
    if (scope.collection === "characters") continue;
    const filter = scopeFilter(scope, sourceCountryId, stateIds);
    const collection = db.collection(scope.collection);
    const rows = await collection.find(filter, { session }).toArray();
    const stateFor = (row: Document): string => {
      if (scope.key === "idIsState") return String(row._id);
      if (scope.key === "compositeCountryState") {
        const id = String(row._id);
        const prefix = `${sourceCountryId}_`;
        if (!id.startsWith(prefix)) throw new Error("Federation regional key changed");
        return id.slice(prefix.length);
      }
      return String(
        row[
          scope.key === "stateField"
            ? "state"
            : scope.key === "homeStateField"
              ? "homeState"
              : "stateId"
        ]
      );
    };
    await archiveRows(scope.collection, rows, stateFor);
    if (rows.length) {
      const removed = await collection.deleteMany(filter, { session });
      if (removed.deletedCount !== rows.length)
        throw new Error(`Federation ${scope.collection} changed during territory archive`);
      regionalRowsArchived += rows.length;
    }
  }
  const removedStates = await db
    .collection<State>("states")
    .deleteMany({ _id: { $in: stateIds }, countryId: sourceCountryId }, { session });
  if (removedStates.deletedCount !== states.length)
    throw new Error("Federation states changed during territory archive");
  return { statesArchived: states.length, regionalRowsArchived };
}
