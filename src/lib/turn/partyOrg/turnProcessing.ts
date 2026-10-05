// src/lib/turn/partyOrg/turnProcessing.ts
import { getDb } from "@/lib/mongodb";
import type { Filter } from "mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import { applyOrganizationDecay } from "@/lib/parties/rules/organizationBucket";

/**
 * Process party org changes for all state parties each turn.
 *
 * The rules core owns legacy bootstrap, inactivity grace, unit decay, and share
 * derivation. This shell performs one projected read and one batched write.
 */
export async function processPartyOrgTurn(currentTurn: number, now = new Date()): Promise<void> {
  const db = await getDb();
  const statePartyOrgCol = db.collection<StatePartyOrg>("statePartyOrg");

  const allSpo = await statePartyOrgCol
    .find({})
    .project<
      Pick<
        StatePartyOrg,
        | "_id"
        | "countryId"
        | "stateId"
        | "organization"
        | "organizationUnits"
        | "lastOrganizationBuildTurn"
      >
    >({
      _id: 1,
      countryId: 1,
      stateId: 1,
      organization: 1,
      organizationUnits: 1,
      lastOrganizationBuildTurn: 1,
    })
    .toArray();

  const rowsByRegion = new Map<string, typeof allSpo>();
  for (const row of allSpo) {
    const key = `${row.countryId}:${row.stateId}`;
    const rows = rowsByRegion.get(key) ?? [];
    rows.push(row);
    rowsByRegion.set(key, rows);
  }

  const updates: Array<{
    updateOne: {
      filter: Filter<StatePartyOrg>;
      update: { $set: Partial<StatePartyOrg> };
    };
  }> = [];

  for (const rows of rowsByRegion.values()) {
    const result = applyOrganizationDecay(
      rows.map((row) => ({
        id: row._id,
        organization: row.organization ?? 0,
        organizationUnits: row.organizationUnits,
        lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
      })),
      currentTurn
    );

    for (const resolved of result.rows) {
      const original = rows.find((row) => row._id === resolved.id);
      if (!original) continue;
      const changed =
        original.organizationUnits !== resolved.organizationUnits ||
        original.lastOrganizationBuildTurn !== resolved.lastOrganizationBuildTurn ||
        Math.abs((original.organization ?? 0) - resolved.organization) >= 0.00005;
      if (!changed) continue;

      updates.push({
        updateOne: {
          // Preserve a Build Org click that lands after this phase's read.
          // Both the durable balance and activity clock must still match the
          // snapshot before decay or legacy bootstrap may replace them.
          filter: {
            _id: original._id,
            $and: [
              original.organizationUnits === undefined
                ? { organizationUnits: { $exists: false } }
                : { organizationUnits: original.organizationUnits },
              original.lastOrganizationBuildTurn === undefined
                ? { lastOrganizationBuildTurn: { $exists: false } }
                : { lastOrganizationBuildTurn: original.lastOrganizationBuildTurn },
            ],
          },
          update: {
            $set: {
              organizationUnits: resolved.organizationUnits,
              lastOrganizationBuildTurn: resolved.lastOrganizationBuildTurn,
              organization: resolved.organization,
              updatedAt: now,
            },
          },
        },
      });
    }
  }

  if (updates.length > 0) {
    await statePartyOrgCol.bulkWrite(updates);
  }
}
