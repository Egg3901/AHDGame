import type { Db } from "mongodb";
import type { GovernorOfficeState } from "@/lib/db/types";
import {
  GUBERNATORIAL_ACTION_CAP,
  GUBERNATORIAL_ACTION_REGEN_INTERVAL,
} from "@/lib/constants/governorOffice";

/**
 * Regenerate office AP for every active office-holder, capped at
 * GUBERNATORIAL_ACTION_CAP, granting +1 every GUBERNATORIAL_ACTION_REGEN_INTERVAL turns.
 *
 * Mirrors `processMinisterialActionRegen` shape for cabinet members.
 */
export async function processGovernorAPRegen(db: Db, currentTurn: number): Promise<number> {
  const states = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .find({})
    .project<Pick<GovernorOfficeState, "_id" | "gubernatorialActions" | "lastActionGrantedTurn">>({
      _id: 1,
      gubernatorialActions: 1,
      lastActionGrantedTurn: 1,
    })
    .toArray();
  let regen = 0;
  const ops: Parameters<typeof db.collection>[0] extends never
    ? never
    : Array<{
        updateOne: {
          filter: {
            _id: NonNullable<GovernorOfficeState["_id"]>;
            gubernatorialActions: number;
            lastActionGrantedTurn: number;
          };
          update: {
            $set: {
              gubernatorialActions: number;
              lastActionGrantedTurn: number;
              updatedAt: Date;
            };
          };
        };
      }> = [];
  for (const s of states) {
    if (s.gubernatorialActions >= GUBERNATORIAL_ACTION_CAP) continue;
    if (currentTurn - s.lastActionGrantedTurn < GUBERNATORIAL_ACTION_REGEN_INTERVAL) continue;
    if (!s._id) continue;
    ops.push({
      updateOne: {
        // Claim the exact snapshot used for the calculation. A player action
        // spending AP during this pass must not be overwritten by a stale set.
        filter: {
          _id: s._id,
          gubernatorialActions: s.gubernatorialActions,
          lastActionGrantedTurn: s.lastActionGrantedTurn,
        },
        update: {
          $set: {
            gubernatorialActions: s.gubernatorialActions + 1,
            lastActionGrantedTurn: currentTurn,
            updatedAt: new Date(),
          },
        },
      },
    });
    regen++;
  }
  if (ops.length > 0) {
    const result = await db.collection<GovernorOfficeState>("governorOfficeState").bulkWrite(ops);
    regen = result.modifiedCount;
  }
  return regen;
}
