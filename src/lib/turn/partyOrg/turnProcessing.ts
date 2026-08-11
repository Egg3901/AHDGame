// src/lib/turn/partyOrg/turnProcessing.ts
import { getDb } from "@/lib/mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import { ORG_DECAY_RATE, MIN_PRESENCE_ORG } from "./constants";

/**
 * Process party org changes for all state parties each turn.
 *
 * Applies passive Org decay (every turn, every party with Org > 0).
 *
 * Org growth is driven by the PS-spend `/build-org` route (per-click at
 * request time), not by a turn-pipeline budget gate. Decay applies
 * unconditionally — players counteract it by clicking Build Org. There
 * is no per-party cap on Org: the state-wide pool sum constraint
 * (`Σ party Org + Unaffiliated Org = 100`) is the only ceiling —
 * enforced at action time by the Unaffiliated-Org headroom check in
 * `/build-org`.
 */
export async function processPartyOrgTurn(): Promise<void> {
  const db = await getDb();
  const statePartyOrgCol = db.collection<StatePartyOrg>("statePartyOrg");

  const allSpo = await statePartyOrgCol
    .find({})
    .project<Pick<StatePartyOrg, "_id" | "organization" | "hasPresence">>({
      _id: 1,
      organization: 1,
      hasPresence: 1,
    })
    .toArray();

  const updates: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: Partial<StatePartyOrg> };
    };
  }> = [];

  for (const spo of allSpo) {
    let newOrg = Number.isFinite(spo.organization) ? spo.organization : 0;

    // Present parties bleed down only to MIN_PRESENCE_ORG (staying contestable);
    // absent parties still decay all the way to 0. Prevents the all-NPP org
    // runaway where a seed-disadvantaged major party hits 0 and is locked out.
    const floor = spo.hasPresence ? MIN_PRESENCE_ORG : 0;
    if (spo.organization > floor) {
      newOrg = Math.max(floor, spo.organization - ORG_DECAY_RATE);
    }

    updates.push({
      updateOne: {
        filter: { _id: spo._id },
        update: {
          $set: {
            organization: Math.round(newOrg * 100) / 100,
            updatedAt: new Date(),
          },
        },
      },
    });
  }

  // Bulk write updates
  if (updates.length > 0) {
    await statePartyOrgCol.bulkWrite(updates);
  }
}
