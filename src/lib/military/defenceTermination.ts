import type { DefenceCarryReason, DefenceContractStatus } from "@/lib/db/types/defenceContract";
import { TARGET_SUPPLIER_MARGIN } from "@/lib/military/defenceLotEconomics";

/**
 * What it costs a defence minister to tear up a contract they have already signed.
 *
 * Awarding a contract to yourself is disclosed and priced (`defenceSelfDealing`). Cancelling
 * someone else's was free: instant, silent, and it handed back both the appropriation and the
 * window quota, so a minister could cancel a rival's order and re-award the freed room to
 * their own plant inside the same window. That asymmetry is the whole exploit, and players
 * reported it as ministers tearing up rivals' contracts rather than as a pricing bug.
 *
 * The answer is the one the rest of the game already uses. Not a ban, and not another cap:
 * a price, disclosure, and a distinction between the two reasons a contract really gets torn
 * up. Terminating for CAUSE, because the supplier is not building, stays free. Terminating
 * for CONVENIENCE, because you would rather the money went somewhere else, pays the supplier
 * the margin they were promised, keeps the window quota spent, and goes on the public wire
 * with the minister's name on it.
 */

/**
 * Withdrawal is an offer nobody accepted, cause is a supplier who cannot build, convenience
 * is everything else. Only the last one costs anything.
 */
export type TerminationBasis = "withdrawal" | "cause" | "convenience";

/**
 * Delivery failures that are the SUPPLIER's to answer for.
 *
 * Deliberately excludes `appropriation_short` and `turn_spend_cap`: those are the buyer
 * running out of money, and letting a minister terminate for cause on their own underfunding
 * would hand back the free cancellation through the side door. `sub_lot_output` and
 * `order_remainder` are a plant working normally.
 */
export const SUPPLIER_FAULT_REASONS: ReadonlySet<DefenceCarryReason> = new Set([
  "no_output",
  "supplier_ineligible",
  "supplier_cannot_fund_loss",
]);

/** Consecutive delivery turns of supplier fault before a contract can be torn up for free. */
export const DEFENCE_TERMINATION_CAUSE_TURNS = 3;

/**
 * Which of the three a given cancellation is.
 *
 * `pending` is a withdrawal whatever else is true: the supplier never accepted, so nothing was
 * promised and nothing is owed. A live contract is for cause only once the plant has missed
 * `DEFENCE_TERMINATION_CAUSE_TURNS` delivery turns in a row for a reason of its own making,
 * which is a streak the delivery sweep counts rather than a state the minister can assert.
 */
export function terminationBasis(input: {
  status: DefenceContractStatus;
  supplierFaultTurns?: number;
}): TerminationBasis {
  if (input.status === "pending") return "withdrawal";
  return (input.supplierFaultTurns ?? 0) >= DEFENCE_TERMINATION_CAUSE_TURNS
    ? "cause"
    : "convenience";
}

/** Contract value the supplier was promised and will now never build. */
export function undeliveredValue(input: {
  lotsOrdered: number;
  lotsDelivered: number;
  pricePerLot: number;
}): number {
  const remaining = Math.max(0, Math.floor(input.lotsOrdered - input.lotsDelivered));
  return Math.max(0, Math.round(remaining * Math.max(0, input.pricePerLot)));
}

/**
 * The break fee, in the country's local currency.
 *
 * The supplier keeps the MARGIN on the lots it was ordered to build and now will not, and
 * nothing more. That is the honest number: the state saves the commodity bill it never
 * incurred, the company keeps the profit it arranged its plant around, and a torn-up contract
 * is cheaper for the treasury than one that runs to term. So terminating is still the right
 * call when the country genuinely does not want the kit, and it is a real cost when the point
 * was to hurt whoever was building it.
 *
 * Withdrawal and cause pay nothing. In the first case there was no bargain; in the second the
 * supplier broke it.
 */
export function terminationFee(input: {
  basis: TerminationBasis;
  lotsOrdered: number;
  lotsDelivered: number;
  pricePerLot: number;
}): number {
  if (input.basis !== "convenience") return 0;
  return Math.round(undeliveredValue(input) * TARGET_SUPPLIER_MARGIN);
}

/**
 * Favorability the minister loses when a torn-up contract reaches the wire.
 *
 * The same shape as the self-dealing penalty, and for the same reason: scaled by how much of
 * the quarter's procurement the order was, so cancelling a token order barely registers and
 * cancelling the tranche is a career event. `conflicted` is the aggravated case, where the
 * minister holds a stake in a DIFFERENT domestic defence supplier, which is what cancelling a
 * rival's contract usually is when it is not a change of mind.
 */
export const TERMINATION_BASE_PENALTY = 1;
export const TERMINATION_MAX_PENALTY = 6;
export const TERMINATION_CONFLICTED_MULTIPLIER = 2;

export function terminationFavorabilityPenalty(input: {
  cancelledValue: number;
  tranche: number;
  conflicted: boolean;
}): number {
  if (!(input.cancelledValue > 0)) return 0;
  const share = input.tranche > 0 ? Math.min(1, input.cancelledValue / input.tranche) : 0;
  const base = Math.min(
    TERMINATION_MAX_PENALTY,
    TERMINATION_BASE_PENALTY + share * (TERMINATION_MAX_PENALTY - TERMINATION_BASE_PENALTY)
  );
  const penalty = input.conflicted ? base * TERMINATION_CONFLICTED_MULTIPLIER : base;
  return Math.round(penalty * 10) / 10;
}

/** One line of public disclosure, in the wire's voice rather than an audit log's. */
export function terminationDisclosure(input: {
  ministerName: string;
  supplierName: string;
  countryName: string;
  lots: number;
  fee: number;
  /** The competing supplier the minister has an interest in, when there is one. */
  competingSupplierName?: string;
}): string {
  const opening =
    `${input.ministerName} has torn up a ${input.countryName} defence contract with ` +
    `${input.supplierName}, cancelling ${input.lots.toLocaleString("en-US")} lots the company ` +
    `had already agreed to build. The treasury owes ${input.supplierName} ` +
    `${Math.round(input.fee).toLocaleString("en-US")} in break fees for work it will now never do.`;
  if (!input.competingSupplierName) return opening;
  return (
    `${opening} ${input.ministerName} holds an interest in ${input.competingSupplierName}, ` +
    `which competes for the same orders.`
  );
}

/** Plain text for the supplier, who finds out from a notification rather than the wire. */
export function terminationNoticeToSupplier(input: {
  basis: TerminationBasis;
  countryName: string;
  lots: number;
  fee: number;
}): string {
  const lots = input.lots.toLocaleString("en-US");
  if (input.basis === "withdrawal") {
    return `${input.countryName} has withdrawn its offer of ${lots} lots before you answered it.`;
  }
  if (input.basis === "cause") {
    return (
      `${input.countryName} has terminated your contract for ${lots} undelivered lots. The ` +
      `plant missed ${DEFENCE_TERMINATION_CAUSE_TURNS} delivery turns in a row, so no break ` +
      `fee is owed.`
    );
  }
  return (
    `${input.countryName} has terminated your contract for ${lots} undelivered lots. You are ` +
    `paid ${Math.round(input.fee).toLocaleString("en-US")} in break fees, and the cancellation ` +
    `is on the public wire.`
  );
}
