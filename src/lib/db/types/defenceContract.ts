import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";

/**
 * `pending` is where every contract starts: a minister awards it, and it does nothing until
 * the supplying CEO accepts. Only `active` delivers or draws on the appropriation.
 * `declined` is the CEO's refusal, kept distinct from the minister's `cancelled` so the
 * order book records who walked away.
 */
export type DefenceContractStatus = "pending" | "active" | "complete" | "cancelled" | "declined";

/**
 * A standing order between a country's defence seat and one of its OWN defence sectors.
 *
 * Domestic only, and that is a hard constraint rather than a simplification: the defence
 * appropriation is denominated in the country's local currency while a corporation carries
 * its own `liquidCurrencyCode` — which is *absent* on pre-forex corps and documented as
 * "treat as USD". Paying across a currency boundary would silently mis-denominate, and there
 * is no exchange-rate document at all for the six Eastern Bloc countries. Sharing a country
 * makes buyer and supplier share a currency by construction. Arms exports need their own
 * design, starting with that question.
 */
export interface DefenceContract {
  _id: ObjectId;
  /** The buying country. Equals the supplying corporation's `countryId` — see above. */
  countryId: CountryId;
  corporationId: ObjectId;
  /** The specific plant. Strategy — and therefore component — is per sector, not per corp. */
  sectorId: ObjectId;
  /**
   * Resolved from the sector's strategy when the contract is awarded, and FROZEN there. A CEO
   * who re-tools mid-contract does not silently start delivering tanks against an order for
   * submarines; the contract is for a component, and re-tooling makes it undeliverable rather
   * than differently-deliverable.
   */
  component: UnitDomain;
  lotsOrdered: number;
  lotsDelivered: number;
  /**
   * Fractional materiel produced but not yet turned into a whole delivered lot, carried turn to
   * turn. Always in [0, 1). Without it a plant producing under one lot per turn delivers nothing
   * forever, because each turn's sub-lot output was floored to zero and discarded.
   */
  deliveryCarry?: number;
  /** Struck at award, in the country's local currency. Does not drift with GDP afterwards. */
  pricePerLot: number;
  /** Quarter-window allocation reserved when this contract was awarded. */
  allocationWindowId?: string;
  /** Lots charged to that allocation. Used to release undelivered quota on cancellation. */
  allocatedLots?: number;
  /** Delivered lots whose payment was administratively recovered after an invalid over-award. */
  administrativeClawbackLots?: number;
  /** Local-currency amount recovered for administrativeClawbackLots. */
  administrativeClawbackAmount?: number;
  /** Invalid payment no longer held by the supplier and therefore not collectible there. */
  administrativeClawbackUnrecoveredAmount?: number;
  administrativeClawbackAt?: Date;
  administrativeClawbackRunId?: string;
  /**
   * Local currency still COMMITTED against the defence appropriation for undelivered lots.
   *
   * Set to the contract's full cost at award and drawn down lot by lot on delivery, so the
   * appropriation always knows what it owes before it is asked to pay. Released in full when
   * the contract is cancelled or declined, and any rounding residue is released on completion.
   * Absent on contracts awarded before encumbrance shipped; those are treated as 0, which is
   * the only safe reading - the money was never reserved for them.
   */
  encumberedAmount?: number;
  /** Local currency actually paid to the supplier so far, across every delivery. */
  amountPaid?: number;
  /** Production cost the supplier has borne so far, so margin is legible on the order book. */
  productionCostPaid?: number;
  /**
   * The grade ceiling the MINISTER set on this order (0..3), bounding what they are willing to
   * pay for as well as what they receive. The delivered grade is the tightest of this, the
   * supplier's research ceiling, and the era cap. Absent means "whatever the supplier can
   * build", which is how every contract behaved before ministers could specify.
   */
  gradeCeiling?: number;
  /**
   * Production lines the CONTRACTOR has assigned to this order, out of
   * `DEFENCE_FACTORY_SLOTS_PER_PLANT`. Throughput scales with it, price per lot does not.
   * Absent on legacy contracts, where the default allocation reproduces the old even split.
   */
  assignedFactories?: number;
  /**
   * Why this contract shipped less than it could have on its last delivery turn, or absent
   * when it shipped everything it built.
   *
   * Every boundary in the sweep - a sub-lot output, an appropriation that cannot cover the
   * turn, an order down to its last part-lot - now CARRIES the work in `deliveryCarry` and
   * records why here. Nothing is discarded silently any more: a plant that appeared to be
   * building nothing for ten turns was in fact having a finished lot destroyed every turn
   * (ticket #1099), and the order book gave the CEO no way to see it.
   */
  carryReason?: DefenceCarryReason;
  /** Turn `carryReason` was last written, so a stale reason is legible as stale. */
  carryReasonTurn?: number;
  /**
   * Public disclosure that the awarding minister had an interest in the supplier. Set once, at
   * award, and never cleared: the record of who signed what does not improve with age.
   */
  selfDealing?: {
    basis: "owner" | "shareholding";
    /** Fraction of the supplier (0..1) the minister held at award. */
    stakeShare: number;
    ministerCharacterId?: ObjectId;
    ministerName?: string;
    /** Favorability the minister paid for it, for the order book to state plainly. */
    favorabilityPenalty: number;
  };
  /**
   * Consecutive delivery turns this contract missed for a reason of the SUPPLIER's making.
   *
   * Counted by the delivery sweep, never asserted by the minister, because it is the thing
   * that decides whether tearing the contract up is free. Reset to zero on any turn that
   * ships, banks normal sub-lot progress, or fails for a reason on the buyer's side. Absent
   * means zero, which is the right reading for every contract awarded before the streak
   * existed: a clean record, not an unprovable one.
   */
  supplierFaultTurns?: number;
  /** Last turn the fault streak was incremented, so a re-run cannot count the same turn twice. */
  supplierFaultThroughTurn?: number;
  /**
   * How this contract ended when a minister ended it, and what that cost.
   *
   * Set once, on cancellation, and never cleared. A withdrawn offer and a contract torn up
   * mid-build are both `status: "cancelled"` on the order book, and the difference between
   * them is the whole point: one owed nothing, the other owed the supplier its margin and put
   * the minister's name on the public wire.
   */
  termination?: {
    basis: "withdrawal" | "cause" | "convenience";
    /** Break fee owed to the supplier, in local currency. Zero unless convenience. */
    fee: number;
    /**
     * Whether the fee's cash leg actually landed. Absent on a termination that owed nothing.
     *
     * False means the order is closed and the supplier has NOT been compensated, which is a
     * repair queue item rather than a settled record. The money-move key is derived from the
     * contract id, so replaying it cannot pay twice.
     */
    feePaid?: boolean;
    /** Undelivered lots at the moment it was torn up. */
    lotsCancelled: number;
    ministerCharacterId?: ObjectId;
    ministerName?: string;
    /** Favorability the minister paid for it, for the order book to state plainly. */
    favorabilityPenalty: number;
    /** A competing domestic supplier the minister holds a stake in, when there was one. */
    competingSupplierName?: string;
    turn: number;
  };
  /**
   * Which economics settle this contract's deliveries (ticket #1134).
   *
   * `"margin"` means build cost is a share of `pricePerLot` at `TARGET_SUPPLIER_MARGIN`, so a
   * delivery converts the appropriation into materiel and pays the supplier a normal return.
   *
   * **ABSENT means the contract predates that fix and settles under the old economics**, where
   * cost was a raw commodity bill unrelated to the price and the supplier kept nearly the whole
   * contract. That is deliberate and it is a rule, not an exception for one order: a player who
   * signed under the old terms keeps them for the lots they have left. A repair never takes
   * away what a player already holds.
   *
   * Absence is the marker precisely so no backfill is needed. Every contract awarded before the
   * deploy lacks the field and is grandfathered by construction, including any awarded between
   * the merge and the release.
   */
  costBasis?: "margin";
  status: DefenceContractStatus;
  awardedTurn: number;
  updatedAt?: Date;
}

/**
 * Why a delivery turn banked output instead of shipping it. Ordered from the supplier's
 * problem to the buyer's, which is also the order the sweep discovers them in.
 */
export type DefenceCarryReason =
  | "sub_lot_output"
  | "appropriation_short"
  | "order_remainder"
  | "supplier_ineligible"
  | "no_output"
  | "supplier_cannot_fund_loss"
  | "turn_spend_cap"
  | "already_settled_this_turn";

/** One line of plain text per reason, shared by the ministerial and corporate order books. */
export const DEFENCE_CARRY_REASON_TEXT: Record<DefenceCarryReason, string> = {
  sub_lot_output:
    "The plant built part of a lot this turn. It is banked and ships as soon as it reaches a " +
    "whole lot.",
  appropriation_short:
    "Lots are built and waiting. The defence appropriation could not cover them this turn, so " +
    "they ship when it can.",
  order_remainder:
    "More was built than the order still needs. The surplus is held against the remaining lots " +
    "rather than delivered.",
  supplier_ineligible:
    "The supplier cannot currently be paid from this appropriation, so nothing shipped.",
  no_output: "The plant produced nothing this turn, so nothing shipped.",
  supplier_cannot_fund_loss:
    "Input prices have risen above the price this order was struck at, and the supplier does " +
    "not have the cash to deliver at a loss. Nothing shipped.",
  turn_spend_cap:
    "Lots are built and waiting. The appropriation is limited in how much it can pay out in a " +
    "single turn, so they ship over the next few turns rather than all at once.",
  already_settled_this_turn: "This contract has already been settled for this turn.",
};
