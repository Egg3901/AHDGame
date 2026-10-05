import type { AnyBulkWriteOperation, Db, Filter } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  ORG_BUILD_UNITS_PER_CLICK,
  ORG_LEGACY_UNITS_PER_PERCENT_MAX,
} from "@/lib/constants/partyOrg";
import type { StatePartyOrg } from "@/lib/db/types";
import {
  deriveOrganizationShares,
  resolveOrganizationUnits,
  type OrganizationBucketResult,
} from "@/lib/parties/rules/organizationBucket";

export interface BuildOrganizationBucketInput {
  countryId: CountryId;
  stateId: string;
  partyId: string;
  stateRowId: string;
  currentTurn: number;
  now: Date;
}

export type BuildOrganizationBucketResult = OrganizationBucketResult & {
  sourceRows: StatePartyOrg[];
};

function roundDelta(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Atomically deposits one Build Org contribution, then refreshes the region's
 * cached percentage shares from the durable unit balances.
 *
 * The unit increment must not be part of the later multi-row share write. Two
 * clicks can overlap, and replacing a balance calculated from an earlier read
 * would lose one of those investments. Mongo's per-document pipeline update
 * makes the contribution and inactivity-clock reset indivisible. Cached Org%
 * can always be derived again from the durable balances.
 */
export async function buildOrganizationBucket(
  db: Db,
  input: BuildOrganizationBucketInput
): Promise<BuildOrganizationBucketResult | null> {
  const collection = db.collection<StatePartyOrg>("statePartyOrg");

  // Convert legacy percentage-only rows as one regional snapshot so their
  // starting unit scale accounts for the permanent Unaffiliated stake. Each
  // write is conditional on the balance still being absent, making concurrent
  // rollout/bootstrap attempts harmless.
  const preBuildRows = await collection
    .find({ countryId: input.countryId, stateId: input.stateId })
    .toArray();
  const preBuildDerived = deriveOrganizationShares(
    preBuildRows.map((row) => ({
      id: row._id,
      organization: row.organization ?? 0,
      organizationUnits: row.organizationUnits,
      lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
    }))
  );
  const bootstrappedUnitsById = new Map(
    preBuildDerived.rows.map((row) => [row.id, row.organizationUnits])
  );
  const legacyRows = preBuildRows.filter((row) => row.organizationUnits === undefined);
  if (legacyRows.length > 0) {
    await collection.bulkWrite(
      legacyRows.map((row) => ({
        updateOne: {
          filter: { _id: row._id, organizationUnits: { $exists: false } },
          update: {
            $set: {
              organizationUnits: bootstrappedUnitsById.get(row._id) ?? 0,
              updatedAt: input.now,
            },
          },
        },
      }))
    );
  }

  const updated = await collection.findOneAndUpdate(
    {
      _id: input.stateRowId,
      countryId: input.countryId,
      stateId: input.stateId,
      partyId: input.partyId,
    },
    [
      {
        $set: {
          organizationUnits: {
            $add: [
              {
                $max: [
                  {
                    $ifNull: [
                      "$organizationUnits",
                      {
                        $multiply: [
                          { $ifNull: ["$organization", 0] },
                          ORG_LEGACY_UNITS_PER_PERCENT_MAX,
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
              ORG_BUILD_UNITS_PER_CLICK,
            ],
          },
          lastOrganizationBuildTurn: input.currentTurn,
          updatedAt: input.now,
        },
      },
    ],
    { returnDocument: "after" }
  );
  if (!updated) return null;
  const atomicUpdated = updated;

  async function loadSnapshot(): Promise<{
    sourceRows: StatePartyOrg[];
    result: OrganizationBucketResult;
  }> {
    const loadedRows = await collection
      .find({ countryId: input.countryId, stateId: input.stateId })
      .toArray();
    // The atomic post-image is a floor for the spender. A lagging read must not
    // erase this click, while a larger live value means another click landed
    // and should win.
    let foundUpdatedRow = false;
    const sourceRows = loadedRows.map((row) => {
      if (row._id === atomicUpdated._id) {
        foundUpdatedRow = true;
        if (row.organizationUnits === undefined) return atomicUpdated;
        const liveUnits = resolveOrganizationUnits(row);
        const updatedUnits = resolveOrganizationUnits(atomicUpdated);
        if (liveUnits >= updatedUnits) return row;
        return {
          ...row,
          organizationUnits: updatedUnits,
          lastOrganizationBuildTurn: atomicUpdated.lastOrganizationBuildTurn,
        };
      }
      if (row.organizationUnits === undefined && bootstrappedUnitsById.has(row._id)) {
        return { ...row, organizationUnits: bootstrappedUnitsById.get(row._id) };
      }
      return row;
    });
    if (!foundUpdatedRow) sourceRows.push(atomicUpdated);
    return {
      sourceRows,
      result: deriveOrganizationShares(
        sourceRows.map((row) => ({
          id: row._id,
          organization: row.organization ?? 0,
          organizationUnits: row.organizationUnits,
          lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
        }))
      ),
    };
  }

  async function writeShares(sourceRows: StatePartyOrg[], result: OrganizationBucketResult) {
    if (result.rows.length === 0) return;
    const sourceById = new Map(sourceRows.map((row) => [row._id, row]));
    const operations: AnyBulkWriteOperation<StatePartyOrg>[] = result.rows.map((row) => {
      const source = sourceById.get(row.id);
      const isLegacy = source?.organizationUnits === undefined;
      const filter: Filter<StatePartyOrg> = isLegacy
        ? { _id: row.id, organizationUnits: { $exists: false } }
        : { _id: row.id, organizationUnits: row.organizationUnits };
      return {
        updateOne: {
          // Do not overwrite a share if its durable balance changed after
          // the snapshot. A missing legacy balance is initialized only if
          // another writer has not already created it.
          filter,
          update: {
            $set: {
              organization: row.organization,
              ...(isLegacy ? { organizationUnits: row.organizationUnits } : {}),
              updatedAt: input.now,
            },
          },
        },
      };
    });
    await collection.bulkWrite(operations);
  }

  const first = await loadSnapshot();
  await writeShares(first.sourceRows, first.result);

  // One reconciliation read closes the practical interleaving where another
  // party deposits after our first snapshot and our older share write lands
  // last. If units changed, recalculate from the newer complete bucket. A click
  // that starts after this read owns the same reconciliation responsibility.
  const reconciled = await loadSnapshot();
  const firstById = new Map(first.result.rows.map((row) => [row.id, row]));
  const changedDuringWrite = reconciled.result.rows.some((row) => {
    const prior = firstById.get(row.id);
    return (
      !prior ||
      prior.organizationUnits !== row.organizationUnits ||
      prior.organization !== row.organization
    );
  });
  if (changedDuringWrite) {
    await writeShares(reconciled.sourceRows, reconciled.result);
  }

  // Attribute only this click in the response and ledger, even if another
  // contribution landed during reconciliation. The counterfactual removes one
  // fixed contribution from this spender while holding every other final
  // balance still.
  const withoutThisClick = deriveOrganizationShares(
    reconciled.result.rows.map((row) => ({
      id: row.id,
      organization: row.organization,
      organizationUnits:
        row.id === input.stateRowId
          ? Math.max(0, row.organizationUnits - ORG_BUILD_UNITS_PER_CLICK)
          : row.organizationUnits,
      lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
    }))
  );
  const counterfactualById = new Map(
    withoutThisClick.rows.map((row) => [row.id, row.organization])
  );

  return {
    ...reconciled.result,
    rows: reconciled.result.rows.map((row) => {
      const previousOrganization = counterfactualById.get(row.id) ?? row.previousOrganization;
      return {
        ...row,
        previousOrganization,
        delta: roundDelta(row.organization - previousOrganization),
      };
    }),
    sourceRows: reconciled.sourceRows,
  };
}
