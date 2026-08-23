import type { Db, ObjectId } from "mongodb";
import type { GovernorExecutiveOrder, LegislationType, StatePolicy } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { buildOrderRevertPolicyFields } from "./revertPolicy";

export interface RescindOrderInput {
  orderId: ObjectId;
  rescindedByCharacterId: ObjectId;
}

/**
 * Rescind an active executive order.
 * - If the StatePolicy row still points at this order, revert it to the snapshot.
 * - If a bill came in mid-flight and replaced the policy, leave the bill's effect alone
 *   (mark the order superseded as a side-effect for accurate history).
 * - No AP refund on rescission.
 */
export async function rescindOrder(
  db: Db,
  input: RescindOrderInput
): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  const order = await db
    .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
    .findOne({ _id: input.orderId });
  if (!order) return { status: 404, body: { error: "Order not found." } };
  if (order.status !== "active") {
    return { status: 400, body: { error: `Order is already ${order.status}.` } };
  }

  const currentTurn = await getCurrentTurn(db);
  const now = new Date();
  const policy = await db.collection<StatePolicy>("statePolicies").findOne({
    stateId: order.stateId,
    legislationTypeId: order.legislationTypeId,
  });

  const policyMatchesOrder =
    policy?.enactedBy?.kind === "order" && policy.enactedBy.id.toString() === order._id!.toString();

  if (policyMatchesOrder && policy) {
    // Revert StatePolicy to pre-order snapshot. Restore the original
    // policyOptionId + axis values from the order snapshot when present so
    // downstream consumers (current-policy comparison, duplicate-provision,
    // State Policy page which matches by axes) read the correct base option.
    // effectDirection comes from the type's own ladder (5-level new-generation
    // ladders center at 2 — the old hardcoded center-3 misdirects them).
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
  }
  // else: policy was overwritten by a bill; leave bill's effect in place.

  await db.collection<GovernorExecutiveOrder>("governorExecutiveOrders").updateOne(
    { _id: order._id! },
    {
      $set: {
        status: policyMatchesOrder ? "rescinded" : "superseded",
        rescindedAtTurn: currentTurn,
        rescindedByCharacterId: input.rescindedByCharacterId,
        updatedAt: now,
      },
    }
  );

  return { status: 200, body: { success: true } };
}
