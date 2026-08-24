import type { Db } from "mongodb";
import type { GovernorExecutiveOrder, LegislationType, StatePolicy } from "@/lib/db/types";
import { buildOrderRevertPolicyFields } from "@/lib/governorOffice/orders/revertPolicy";

/**
 * Turn phase: process active executive orders.
 * - If the StatePolicy no longer points at this order (a bill superseded it),
 *   mark the order as superseded. Don't touch the policy.
 * - If currentTurn >= expiresAtTurn AND the policy still points at this order,
 *   revert the policy to the snapshot and mark the order as expired.
 *
 * Must run AFTER processBillEnactment so any same-turn bill that overwrote the
 * policy is observed here and wins.
 */
export async function processGovernorExecutiveOrders(
  db: Db,
  currentTurn: number
): Promise<{ expired: number; superseded: number }> {
  const active = await db
    .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
    .find({ status: "active" })
    .toArray();
  const now = new Date();
  let expired = 0;
  let superseded = 0;

  for (const order of active) {
    if (!order._id) continue;
    const policy = await db
      .collection<StatePolicy>("statePolicies")
      .findOne({ stateId: order.stateId, legislationTypeId: order.legislationTypeId });
    const policyMatchesOrder =
      policy?.enactedBy?.kind === "order" &&
      policy.enactedBy.id.toString() === order._id.toString();

    if (!policyMatchesOrder) {
      const supersedingBillId =
        policy?.enactedBy?.kind === "bill" ? policy.enactedBy.id : undefined;
      await db.collection<GovernorExecutiveOrder>("governorExecutiveOrders").updateOne(
        { _id: order._id },
        {
          $set: {
            status: "superseded",
            ...(supersedingBillId ? { supersededByBillId: supersedingBillId } : {}),
            updatedAt: now,
          },
        }
      );
      superseded++;
      continue;
    }

    if (currentTurn >= order.expiresAtTurn) {
      // effectDirection from the type's own ladder — 5-level new-generation
      // ladders center at 2; the old hardcoded center-3 misdirects them
      // (political-legislation spec §10 option-count sweep).
      const legislationType = await db
        .collection<LegislationType>("legislationTypes")
        .findOne({ _id: order.legislationTypeId }, { projection: { policyOptions: 1 } });
      await db.collection<StatePolicy>("statePolicies").updateOne(
        { stateId: order.stateId, legislationTypeId: order.legislationTypeId },
        {
          $set: {
            ...buildOrderRevertPolicyFields(order, legislationType, currentTurn),
          },
        }
      );
      await db
        .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
        .updateOne({ _id: order._id }, { $set: { status: "expired", updatedAt: now } });
      expired++;
    }
  }

  return { expired, superseded };
}
