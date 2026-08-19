import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import type { DefenceContract, DefenceCarryReason } from "@/lib/db/types/defenceContract";
import { releaseDefenceContractLots } from "./defenceProcurementAllocations";
import { releaseEncumbrance } from "./defenseAppropriation";

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
    allocationWindowId?: string;
    allocatedLots?: number;
    /** Local currency already reserved against the appropriation for this order. */
    encumberedAmount?: number;
    /** Minister's grade ceiling (0..3); absent means whatever the supplier can build. */
    gradeCeiling?: number;
    /** Production lines the order starts with; the contractor may change it afterwards. */
    assignedFactories?: number;
    selfDealing?: DefenceContract["selfDealing"];
    /**
     * State-owned suppliers have no player CEO to accept. Activate immediately so the
     * order delivers rather than sitting pending forever (ticket #1087).
     */
    activateImmediately?: boolean;
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
    allocationWindowId: input.allocationWindowId,
    allocatedLots: input.allocatedLots,
    encumberedAmount: Math.max(0, Math.round(input.encumberedAmount ?? 0)),
    amountPaid: 0,
    productionCostPaid: 0,
    ...(input.gradeCeiling != null ? { gradeCeiling: input.gradeCeiling } : {}),
    ...(input.assignedFactories != null ? { assignedFactories: input.assignedFactories } : {}),
    ...(input.selfDealing ? { selfDealing: input.selfDealing } : {}),
    // Stamped on every new award. Contracts without it settle under the pre-#1134 economics
    // they were signed under; see `DefenceContract.costBasis`.
    costBasis: "margin",
    // An offer, not an order, unless the buyer is contracting its own state industry.
    // A National Corporation has no player CEO to click Accept; leaving those pending
    // meant the arsenal never filled.
    status: input.activateImmediately ? "active" : "pending",
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
    // can never deliver again sitting in the buyer's active list. Nothing is being paid on
    // this path, so any commitment it still holds is safe to hand straight back.
    await contracts(db).updateOne(
      { _id: contractId, status: "active" },
      { $set: { status: "complete", updatedAt: new Date() } }
    );
    await releaseContractEncumbrance(db, contractId);
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
  // The residual encumbrance is deliberately NOT released here. The caller has not booked this
  // delivery's payment yet, so releasing now would hand back money that is about to be spent
  // and drive the contract's own commitment negative. `applyDefenceDeliveries` releases the
  // residue after `recordContractPayment`, which is the only point at which the remaining
  // commitment is actually known.
  return recorded;
}

/**
 * Undo a lot record whose payment did not land.
 *
 * The delivery sweep records lots BEFORE it moves money now, because the money primitive
 * guards its own debit and reports a refused move without having touched a balance. That makes
 * an un-paid lot record the only thing left to unwind, and it has to be exact: the contract is
 * reopened if the reversal takes it back below its ordered count, or a fully-delivered order
 * would stay closed holding lots nobody paid for.
 *
 * Guarded on `lotsDelivered` so a reversal racing a concurrent delivery cannot take back lots
 * that delivery legitimately recorded.
 */
export async function reverseContractDelivery(
  db: Db,
  contractId: ObjectId,
  lots: number
): Promise<boolean> {
  const back = Math.max(0, Math.round(lots));
  if (back <= 0) return true;
  const contract = await contracts(db).findOne({ _id: contractId });
  if (!contract) return false;
  const remainingAfter = contract.lotsDelivered - back;
  if (remainingAfter < 0) return false;
  const res = await contracts(db).updateOne(
    { _id: contractId, lotsDelivered: contract.lotsDelivered },
    {
      $inc: { lotsDelivered: -back },
      $set: {
        updatedAt: new Date(),
        ...(remainingAfter < contract.lotsOrdered ? { status: "active" as const } : {}),
      },
    }
  );
  return res.modifiedCount > 0;
}

/**
 * Book what a delivery cost the buyer and the supplier, and draw the encumbrance down by the
 * same amount.
 *
 * Separate from `advanceContract` because lots and money are separate facts here: the sweep
 * records the lots and then pays (see `applyDefenceDeliveries`), and `advanceContract` clamps,
 * so the lot count can differ from what was planned and the two must be reconcilable
 * afterwards rather than assumed equal.
 */
export async function recordContractPayment(
  db: Db,
  contractId: ObjectId,
  paid: number,
  productionCost: number
): Promise<void> {
  const amount = Math.round(paid);
  const cost = Math.round(productionCost);
  if (amount === 0 && cost === 0) return;
  await contracts(db).updateOne(
    { _id: contractId },
    {
      $inc: {
        amountPaid: amount,
        productionCostPaid: cost,
        encumberedAmount: -amount,
      },
      $set: { updatedAt: new Date() },
    }
  );
}

/**
 * Hand back every unit of appropriation this contract still holds, on both books.
 *
 * Two writes that must agree: the country's `defenseAppropriation.encumbered` and the
 * contract's own `encumberedAmount`. The contract is zeroed by a guarded update on the value
 * that was read, so two concurrent releases (a cancel racing a completion) cannot both
 * release the same money and drive the country's commitment negative.
 */
export async function releaseContractEncumbrance(db: Db, contractId: ObjectId): Promise<number> {
  const contract = await contracts(db).findOne({ _id: contractId });
  const held = Math.max(0, Math.round(contract?.encumberedAmount ?? 0));
  if (!contract || held <= 0) return 0;
  const res = await contracts(db).updateOne(
    { _id: contractId, encumberedAmount: held },
    { $set: { encumberedAmount: 0, updatedAt: new Date() } }
  );
  if (res.modifiedCount === 0) return 0;
  await releaseEncumbrance(db, contract.countryId, held);
  return held;
}

/**
 * Persist the sub-lot production a plant has accumulated toward its next whole deliverable lot.
 * Kept separate from `advanceContract` because it must be stamped every turn, including the many
 * turns a small plant delivers nothing — that is exactly the output that used to be discarded.
 */
export async function stampDeliveryCarry(
  db: Db,
  contractId: ObjectId,
  carry: number,
  reason?: DefenceCarryReason,
  turn?: number
): Promise<void> {
  await contracts(db).updateOne(
    { _id: contractId, status: "active" },
    {
      $set: {
        deliveryCarry: carry,
        // The reason is stamped on EVERY delivery turn, shipped or not, so the order book can
        // always answer "why did this not move". An unset reason means it shipped everything
        // it built, which is a different statement from "we do not know".
        ...(reason ? { carryReason: reason } : {}),
        ...(turn != null ? { carryReasonTurn: turn } : {}),
      },
      ...(reason ? {} : { $unset: { carryReason: "" } }),
    }
  );
}

/**
 * Cancel a contract the buyer no longer wants — a live order or an offer the supplier has
 * not answered. Idempotent: cancelling a closed one is a no-op, not an error.
 */
export async function cancelContract(db: Db, contractId: ObjectId): Promise<boolean> {
  const contract = await contracts(db).findOne({ _id: contractId });
  if (!contract || !["pending", "active"].includes(contract.status)) return false;
  const res = await contracts(db).updateOne(
    { _id: contractId, status: { $in: ["pending", "active"] } },
    { $set: { status: "cancelled", updatedAt: new Date() } }
  );
  if (res.modifiedCount === 0) return false;
  // Money first: a withdrawn order must stop holding the appropriation immediately, even if
  // the window quota release below fails. The reverse order would leave the country unable to
  // re-spend budget on an order that no longer exists.
  await releaseContractEncumbrance(db, contractId);
  if (contract.allocationWindowId && contract.allocatedLots) {
    const undelivered = Math.max(0, contract.allocatedLots - contract.lotsDelivered);
    await releaseDefenceContractLots(
      db,
      contract.allocationWindowId,
      contract.corporationId.toString(),
      undelivered * contract.pricePerLot
    );
  }
  return true;
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
  const contract = await contracts(db).findOne({ _id: contractId, status: "pending" });
  if (!contract) return false;
  const res = await contracts(db).updateOne(
    { _id: contractId, status: "pending" },
    {
      $set: {
        status: accept ? ("active" as const) : ("declined" as const),
        updatedAt: new Date(),
      },
    }
  );
  if (!accept && res.modifiedCount > 0) {
    // A declined offer never builds anything, so it must give back everything it reserved:
    // the appropriation it encumbered and the window quota it took off other suppliers.
    await releaseContractEncumbrance(db, contractId);
    if (contract.allocationWindowId && contract.allocatedLots) {
      await releaseDefenceContractLots(
        db,
        contract.allocationWindowId,
        contract.corporationId.toString(),
        contract.allocatedLots * contract.pricePerLot
      );
    }
  }
  return res.modifiedCount > 0;
}

/**
 * The contractor's production-line allocation for one order (suggestion #281).
 *
 * Bounded by the caller against what the plant has free - this write only guards that the
 * contract is still live, so a CEO cannot re-allocate an order the minister has withdrawn.
 * Price per lot is deliberately untouched: allocation buys SPEED, not a better deal. Letting
 * it move the price would make it a second, hidden negotiation the minister never agreed to.
 */
export async function setContractFactories(
  db: Db,
  contractId: ObjectId,
  assignedFactories: number
): Promise<boolean> {
  const res = await contracts(db).updateOne(
    { _id: contractId, status: { $in: ["pending", "active"] } },
    { $set: { assignedFactories, updatedAt: new Date() } }
  );
  return res.modifiedCount > 0;
}

/**
 * Lines already committed on a plant, excluding one contract the caller is re-allocating.
 *
 * `defaultAllocation` is what a contract with no stored allocation counts as. Legacy orders
 * have none, and reading those as zero would report a fully-booked plant as idle and let a
 * new order over-commit it - the exact double-booking the slot model exists to stop.
 */
export async function assignedFactoriesForSector(
  db: Db,
  sectorId: ObjectId,
  defaultAllocation: number,
  excludeContractId?: ObjectId
): Promise<number> {
  const live = await contracts(db)
    .find({ sectorId, status: { $in: ["pending", "active"] } })
    .toArray();
  return live
    .filter((c) => !excludeContractId || c._id.toString() !== excludeContractId.toString())
    .reduce((sum, c) => sum + Math.max(0, c.assignedFactories ?? defaultAllocation), 0);
}
