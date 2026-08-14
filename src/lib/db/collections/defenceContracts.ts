import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import type { DefenceContract } from "@/lib/db/types/defenceContract";

function contracts(db: Db) {
  return db.collection<DefenceContract>("defenceContracts");
}

/** Every contract a country is currently buying against. */
export async function listActiveContracts(db: Db, countryId: string): Promise<DefenceContract[]> {
  return contracts(db)
    .find({ countryId: countryId as CountryId, status: "active" })
    .toArray();
}

/**
 * Everything on the buyer's board — live orders AND offers awaiting a supplier's answer.
 *
 * Deliberately separate from `listActiveContracts`, which the DELIVERY step uses: a pending
 * offer must never build or bill. This is the ministerial VIEW, where an unanswered offer is
 * exactly what the minister needs to see.
 */
export async function listOpenContracts(db: Db, countryId: string): Promise<DefenceContract[]> {
  return contracts(db)
    .find({ countryId: countryId as CountryId, status: { $in: ["pending", "active"] } })
    .sort({ awardedTurn: -1 })
    .toArray();
}

/** Every contract a corporation holds, in any state — the CEO's view. */
export async function listContractsForCorp(
  db: Db,
  corporationId: ObjectId
): Promise<DefenceContract[]> {
  return contracts(db).find({ corporationId }).sort({ awardedTurn: -1 }).toArray();
}

export async function awardContract(
  db: Db,
  input: {
    countryId: string;
    corporationId: ObjectId;
    sectorId: ObjectId;
    component: UnitDomain;
    lotsOrdered: number;
    pricePerLot: number;
    awardedTurn: number;
  }
): Promise<DefenceContract> {
  const doc: DefenceContract = {
    _id: new ObjectId(),
    countryId: input.countryId as CountryId,
    corporationId: input.corporationId,
    sectorId: input.sectorId,
    component: input.component,
    lotsOrdered: Math.max(1, Math.round(input.lotsOrdered)),
    lotsDelivered: 0,
    pricePerLot: Math.max(0, Math.round(input.pricePerLot)),
    // An offer, not an order. The supplying CEO has to accept before anything is built or
    // any money moves — see `respondToContract`.
    status: "pending",
    awardedTurn: input.awardedTurn,
    updatedAt: new Date(),
  };
  await contracts(db).insertOne(doc);
  return doc;
}

/**
 * Record delivered lots, completing the contract when the order is filled.
 *
 * Clamps to what remains rather than trusting the caller: the delivery step computes lots
 * from live sector revenue, and a contract must never record more delivered than ordered —
 * that figure is what the buyer is billed against.
 *
 * Returns the number actually recorded, which is what the caller should pay for.
 */
export async function advanceContract(db: Db, contractId: ObjectId, lots: number): Promise<number> {
  const wanted = Math.max(0, Math.round(lots));
  if (wanted <= 0) return 0;

  const contract = await contracts(db).findOne({ _id: contractId, status: "active" });
  if (!contract) return 0;

  const remaining = Math.max(0, contract.lotsOrdered - contract.lotsDelivered);
  const recorded = Math.min(wanted, remaining);
  if (recorded <= 0) {
    // Already filled but still marked active — close it rather than leaving a contract that
    // can never deliver again sitting in the buyer's active list.
    await contracts(db).updateOne(
      { _id: contractId, status: "active" },
      { $set: { status: "complete", updatedAt: new Date() } }
    );
    return 0;
  }

  const nowComplete = contract.lotsDelivered + recorded >= contract.lotsOrdered;
  await contracts(db).updateOne(
    { _id: contractId, status: "active" },
    {
      $inc: { lotsDelivered: recorded },
      $set: { updatedAt: new Date(), ...(nowComplete ? { status: "complete" as const } : {}) },
    }
  );
  return recorded;
}

/**
 * Persist the sub-lot production a plant has accumulated toward its next whole deliverable lot.
 * Kept separate from `advanceContract` because it must be stamped every turn, including the many
 * turns a small plant delivers nothing — that is exactly the output that used to be discarded.
 */
export async function stampDeliveryCarry(
  db: Db,
  contractId: ObjectId,
  carry: number
): Promise<void> {
  await contracts(db).updateOne(
    { _id: contractId, status: "active" },
    { $set: { deliveryCarry: carry } }
  );
}

/**
 * Cancel a contract the buyer no longer wants — a live order or an offer the supplier has
 * not answered. Idempotent: cancelling a closed one is a no-op, not an error.
 */
export async function cancelContract(db: Db, contractId: ObjectId): Promise<boolean> {
  const res = await contracts(db).updateOne(
    { _id: contractId, status: { $in: ["pending", "active"] } },
    { $set: { status: "cancelled", updatedAt: new Date() } }
  );
  return res.modifiedCount > 0;
}

/**
 * The supplier's answer to an offer.
 *
 * Guarded on `status: "pending"` so the transition is atomic — two clicks, or an accept
 * racing the minister's cancel, resolve to exactly one winner rather than reviving a
 * cancelled order. Returns false when the offer was already answered or withdrawn, which
 * the route surfaces as a 409 rather than a silent success.
 */
export async function respondToContract(
  db: Db,
  contractId: ObjectId,
  accept: boolean
): Promise<boolean> {
  const res = await contracts(db).updateOne(
    { _id: contractId, status: "pending" },
    {
      $set: {
        status: accept ? ("active" as const) : ("declined" as const),
        updatedAt: new Date(),
      },
    }
  );
  return res.modifiedCount > 0;
}
