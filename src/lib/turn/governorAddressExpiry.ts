import type { Db } from "mongodb";
import type { GovernorAddress } from "@/lib/db/types";
import type { StateDemographicTurnout } from "@/lib/db/types/stateDemographicTurnout";
import { readTurnoutModifier, turnoutModifierPath } from "@/lib/demographics/turnoutTarget";

/**
 * Turn phase: expire address effects whose `expiresAtTurn` has passed.
 *
 * Approval bump expires read-side (callers filter by
 * `approvalEffect.expiresAtTurn > currentTurn`); this phase just flips the
 * `expired` flag so the row stops being picked up by historical queries.
 *
 * Demographic turnout boost is applied write-side at delivery (added to
 * `stateDemographicTurnout.modifiers.voterGroups[group]`) so at expiry we
 * subtract the snapshotted `turnoutDelta` back out. Modifier is left clamped
 * to 0 minimum so concurrent canvassing decay can't push it below floor.
 *
 * Agenda effect is purely read-side (consumed in stateBillVoting cross-pressure),
 * so expiry is just a flag flip — no compensating action needed.
 */
export async function processGovernorAddressExpiry(
  db: Db,
  currentTurn: number
): Promise<{ approvalExpired: number; demographicExpired: number; turnoutReverted: number }> {
  const candidates = await db
    .collection<GovernorAddress>("governorAddresses")
    .find({
      $or: [
        {
          "approvalEffect.expired": { $ne: true },
          "approvalEffect.expiresAtTurn": { $lte: currentTurn },
        },
        {
          "demographicEffect.expired": { $ne: true },
          "demographicEffect.expiresAtTurn": { $lte: currentTurn },
        },
      ],
    })
    .toArray();

  let approvalExpired = 0;
  let demographicExpired = 0;
  let turnoutReverted = 0;
  for (const a of candidates) {
    const setOps: Record<string, true> = {};
    if (!a.approvalEffect.expired && a.approvalEffect.expiresAtTurn <= currentTurn) {
      setOps["approvalEffect.expired"] = true;
      approvalExpired++;
    }
    if (!a.demographicEffect.expired && a.demographicEffect.expiresAtTurn <= currentTurn) {
      setOps["demographicEffect.expired"] = true;
      demographicExpired++;
      // Subtract the snapshotted turnout boost back out of the
      // stateDemographicTurnout modifier, clamped to the -20..+20 range used
      // elsewhere. National-scope addresses snapshot a per-state delta map
      // (revert each state precisely); state-scope addresses use the scalar.
      // If neither was recorded (legacy v1 row), skip — there's nothing to
      // subtract reliably.
      const groupId = a.targetDemographicGroupId;
      const deltasByState = a.demographicEffect.turnoutDeltasByState;
      if (groupId && deltasByState && Object.keys(deltasByState).length > 0) {
        const stateIds = Object.keys(deltasByState);
        const turnoutDocs = await db
          .collection<StateDemographicTurnout>("stateDemographicTurnout")
          .find({ _id: { $in: stateIds } })
          .toArray();
        const currentByState = new Map(
          turnoutDocs.map((d) => [d._id, readTurnoutModifier(d.modifiers, groupId)])
        );
        const modifierPath = turnoutModifierPath(groupId);
        const ops: Array<{
          updateOne: {
            filter: { _id: string };
            update: { $set: Record<string, unknown> };
          };
        }> = [];
        for (const sId of stateIds) {
          const current = currentByState.get(sId) ?? 0;
          const delta = deltasByState[sId];
          const next = Math.max(-20, Math.min(20, current - delta));
          ops.push({
            updateOne: {
              filter: { _id: sId },
              update: {
                $set: {
                  [modifierPath]: next,
                  lastUpdated: new Date(),
                },
              },
            },
          });
        }
        if (ops.length > 0) {
          await db.collection<StateDemographicTurnout>("stateDemographicTurnout").bulkWrite(ops);
          turnoutReverted += ops.length;
        }
      } else {
        const delta = a.demographicEffect.turnoutDelta ?? 0;
        if (delta > 0 && groupId) {
          const turnoutDoc = await db
            .collection<StateDemographicTurnout>("stateDemographicTurnout")
            .findOne({ _id: a.stateId });
          const currentModifier = readTurnoutModifier(turnoutDoc?.modifiers, groupId);
          const newModifier = Math.max(-20, Math.min(20, currentModifier - delta));
          await db.collection<StateDemographicTurnout>("stateDemographicTurnout").updateOne(
            { _id: a.stateId },
            {
              $set: {
                [turnoutModifierPath(groupId)]: newModifier,
                lastUpdated: new Date(),
              },
            }
          );
          turnoutReverted++;
        }
      }
    }
    if (Object.keys(setOps).length > 0) {
      await db
        .collection<GovernorAddress>("governorAddresses")
        .updateOne({ _id: a._id }, { $set: setOps });
    }
  }
  return { approvalExpired, demographicExpired, turnoutReverted };
}
