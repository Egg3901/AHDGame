/**
 * Legacy federation debt service collects agreed successor contributions into
 * the retired issuer's settlement administration. planLegacyDebtService keeps
 * creditor contracts with their original issuer and records funding shortfalls.
 */
import { allocateSuccessionDebtService, type SuccessionFinancialPlan } from "./financialSettlement";

export interface LegacyServiceInput {
  finances: SuccessionFinancialPlan;
  /** Contractual payment due this turn, in the existing issuer's accounting minor units. */
  dueMinor: number;
  /** Existing cash in the legacy settlement administration before contributions. */
  administrationCashMinor: number;
  /** Actual available successor budget balances after protected spending. */
  availableMinorBySuccessor: Readonly<Record<string, number>>;
}

export interface LegacyServicePlan {
  settlementId: string;
  servicingIssuerId: string;
  dueMinor: number;
  successorCallsMinor: Record<string, number>;
  successorContributionsMinor: Record<string, number>;
  successorArrearsMinor: Record<string, number>;
  creditorPaymentMinor: number;
  creditorShortfallMinor: number;
  administrationCashAfterMinor: number;
}

function whole(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative safe integer`);
}

/** No successor creates a new creditor bond; its unpaid contribution is an internal claim. */
export function planLegacyDebtService(input: LegacyServiceInput): LegacyServicePlan {
  if (input.finances.servicingEntityKind !== "legacy-administration")
    throw new Error("Existing continuing states service contracts through their own budget");
  whole(input.dueMinor, "Contractual service");
  whole(input.administrationCashMinor, "Administration cash");
  const successorCallsMinor = allocateSuccessionDebtService(input.finances, input.dueMinor);
  const ids = Object.keys(successorCallsMinor).sort();
  if (
    Object.keys(input.availableMinorBySuccessor).length !== ids.length ||
    ids.some((id) => !Object.hasOwn(input.availableMinorBySuccessor, id))
  )
    throw new Error("Every successor budget must be available for service planning");
  const successorContributionsMinor: Record<string, number> = {};
  const successorArrearsMinor: Record<string, number> = {};
  let received = BigInt(0);
  for (const id of ids) {
    const available = input.availableMinorBySuccessor[id];
    whole(available, "Successor available balance");
    const contribution = Math.min(successorCallsMinor[id], available);
    successorContributionsMinor[id] = contribution;
    successorArrearsMinor[id] = successorCallsMinor[id] - contribution;
    received += BigInt(contribution);
  }
  const cash = BigInt(input.administrationCashMinor) + received;
  if (cash > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Settlement cash exceeds supported accounting precision");
  const payment = cash < BigInt(input.dueMinor) ? cash : BigInt(input.dueMinor);
  return {
    settlementId: input.finances.settlementId,
    servicingIssuerId: input.finances.servicingIssuerId,
    dueMinor: input.dueMinor,
    successorCallsMinor,
    successorContributionsMinor,
    successorArrearsMinor,
    creditorPaymentMinor: Number(payment),
    creditorShortfallMinor: input.dueMinor - Number(payment),
    administrationCashAfterMinor: Number(cash - payment),
  };
}
