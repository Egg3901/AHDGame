/**
 * Tender reservations hold defence appropriation and quarterly quota before bidding.
 * Named markers make reserve, conversion and release retryable without releasing another order's funds.
 */
import type { Db } from "mongodb";
import {
  defenceContractLotCaps,
  defenceContractWindow,
  defenceSupplierCapShare,
} from "@/lib/military/defenceContractLimits";
import { getDefenseAppropriation } from "@/lib/db/collections/defenseAppropriation";
import { tenders } from "./persistence";
import type { GovernmentTender } from "./types";

const marker = (id: string) => `governmentTenderReservations.${id}`;
const potMarker = (id: string) => `defenseAppropriation.governmentTenderReservations.${id}`;
export async function reserveDefenceTender(
  db: Db,
  t: GovernmentTender,
  defenseLine: number
): Promise<boolean> {
  const window = defenceContractWindow(t.countryId, t.publishedTurn);
  const cap = defenceContractLotCaps(defenseLine, 1).procurementNotional;
  const m = marker(t._id),
    p = potMarker(t._id);
  const quotas = db.collection("defenceProcurementAllocations");
  try {
    await quotas.updateOne(
      { _id: window.id as never },
      {
        $setOnInsert: {
          countryId: t.countryId,
          windowIndex: window.index,
          startTurn: window.startTurn,
          endTurn: window.endTurn,
          countryAmount: 0,
          supplierAmounts: {},
        },
      },
      { upsert: true }
    );
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
  }
  await quotas.updateOne(
    {
      _id: window.id as never,
      [m]: { $exists: false },
      $expr: { $lte: [{ $ifNull: ["$countryAmount", 0] }, cap - t.reservedAmount] },
    },
    {
      $inc: { countryAmount: t.reservedAmount },
      $set: { [m]: { state: "held", amount: t.reservedAmount } },
    }
  );
  const quota = await quotas.findOne(
    { _id: window.id as never, [`${m}.state`]: "held" },
    { projection: { _id: 1 } }
  );
  if (!quota) return false;
  await getDefenseAppropriation(db, t.countryId);
  await db.collection("federalBudget").updateOne(
    {
      countryId: t.countryId,
      [p]: { $exists: false },
      $expr: {
        $gte: [
          {
            $subtract: [
              { $ifNull: ["$defenseAppropriation.balance", 0] },
              { $ifNull: ["$defenseAppropriation.encumbered", 0] },
            ],
          },
          t.reservedAmount,
        ],
      },
    },
    {
      $inc: { "defenseAppropriation.encumbered": t.reservedAmount },
      $set: { [p]: { state: "held", amount: t.reservedAmount } },
    }
  );
  return !!(await db
    .collection("federalBudget")
    .findOne({ countryId: t.countryId, [`${p}.state`]: "held" }, { projection: { _id: 1 } }));
}
export async function convertDefenceReservation(
  db: Db,
  t: GovernmentTender,
  corporationId: string,
  amount: number,
  defenseLine: number,
  stateOwned: boolean
): Promise<boolean> {
  const m = marker(t._id),
    p = potMarker(t._id);
  const field = `supplierAmounts.${corporationId}`;
  const cap =
    defenceContractLotCaps(defenseLine, 1).procurementNotional *
    defenceSupplierCapShare(stateOwned);
  await db.collection("defenceProcurementAllocations").updateOne(
    {
      _id: t.allocationWindowId as never,
      [`${m}.state`]: "held",
      $expr: {
        $and: [
          { $lte: [{ $ifNull: [`$${field}`, 0] }, cap - amount] },
          {
            $lte: [
              { $ifNull: ["$countryAmount", 0] },
              defenceContractLotCaps(defenseLine, 1).procurementNotional +
                t.reservedAmount -
                amount,
            ],
          },
        ],
      },
    },
    {
      $inc: { countryAmount: amount - t.reservedAmount, [field]: amount },
      $set: { [m]: { state: "converted", amount, corporationId } },
    }
  );
  const quota = await db.collection("defenceProcurementAllocations").findOne(
    {
      _id: t.allocationWindowId as never,
      [`${m}.state`]: "converted",
      [`${m}.corporationId`]: corporationId,
    },
    { projection: { _id: 1 } }
  );
  if (!quota) return false;
  await db.collection("federalBudget").updateOne(
    {
      countryId: t.countryId,
      [`${p}.state`]: "held",
    },
    {
      $inc: { "defenseAppropriation.encumbered": amount - t.reservedAmount },
      $set: { [p]: { state: "converted", amount } },
    }
  );
  const converted = await db
    .collection("federalBudget")
    .findOne({ countryId: t.countryId, [`${p}.state`]: "converted" }, { projection: { _id: 1 } });
  if (!converted)
    throw new Error("Tender quota converted; appropriation conversion needs recovery.");
  return true;
}

/** Five batched commands at most; terminal reservations are retried after interrupted releases. */
export async function expireGovernmentTenders(db: Db, turn: number): Promise<void> {
  await tenders(db).updateMany(
    {
      status: { $in: ["open", "publishing"] },
      awardDeadlineTurn: { $lte: turn },
    },
    {
      $set: {
        status: "canceled",
        cancellationReason: "The award deadline passed without an award.",
      },
    }
  );
  const canceled = await tenders(db)
    .find(
      { status: "canceled", reservationReleased: { $ne: true } },
      {
        projection: {
          _id: 1,
          countryId: 1,
          allocationWindowId: 1,
          reservedAmount: 1,
          "terms.type": 1,
        },
      }
    )
    .toArray();
  if (!canceled.length) return;
  const defence = canceled.filter((t) => t.terms.type === "defence");
  if (defence.length) {
    await db.collection("federalBudget").bulkWrite(
      defence.map((t) => ({
        updateOne: {
          filter: { countryId: t.countryId, [`${potMarker(t._id)}.state`]: "held" },
          update: {
            $inc: { "defenseAppropriation.encumbered": -t.reservedAmount },
            $set: { [`${potMarker(t._id)}.state`]: "released" },
          },
        },
      }))
    );
    await db.collection("defenceProcurementAllocations").bulkWrite(
      defence.map((t) => ({
        updateOne: {
          filter: { _id: t.allocationWindowId as never, [`${marker(t._id)}.state`]: "held" },
          update: {
            $inc: { countryAmount: -t.reservedAmount },
            $set: { [`${marker(t._id)}.state`]: "released" },
          },
        },
      }))
    );
  }
  await tenders(db).updateMany(
    { _id: { $in: canceled.map((t) => t._id) }, status: "canceled" },
    { $set: { reservationReleased: true } }
  );
}
