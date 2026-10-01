/**
 * Continuing federation issuers collect agreed contributions on inherited debt.
 * planContinuingDebtService keeps new borrowing outside the settlement and
 * carries each successor's unpaid contribution forward to that same successor.
 */
import { allocateSuccessionAmount, type SuccessionFinancialPlan } from "./financialSettlement";

/** Use the existing legacy successor penalty for an unpaid contribution. */
export function continuingContributionRiskLoss(callMinor: number, arrearsMinor: number): number {
  if (
    [callMinor, arrearsMinor].some((value) => !Number.isSafeInteger(value) || value < 0) ||
    arrearsMinor > callMinor
  )
    throw new Error("Invalid successor contribution risk balance");
  return callMinor > 0 ? Math.min(0.02, (arrearsMinor / callMinor) * 0.02) : 0;
}

export function planContinuingDebtService(input: {
  finances: SuccessionFinancialPlan;
  dueMinor: number;
  availableMinorBySuccessor: Readonly<Record<string, number>>;
  priorArrearsMinor: Readonly<Record<string, number>>;
}): {
  issuerOwnShareMinor: number;
  successorCallsMinor: Record<string, number>;
  successorContributionsMinor: Record<string, number>;
  successorArrearsMinor: Record<string, number>;
  totalContributionsMinor: number;
} {
  const { finances, dueMinor, availableMinorBySuccessor, priorArrearsMinor } = input;
  if (
    finances.servicingEntityKind !== "continuing-state" ||
    !Object.hasOwn(finances.debtWeights, finances.servicingIssuerId)
  )
    throw new Error("Continuing service needs an approved continuing issuer");
  const calls = allocateSuccessionAmount(dueMinor, finances.debtWeights);
  const ids = Object.keys(calls)
    .filter((id) => id !== finances.servicingIssuerId)
    .sort();
  if (
    !ids.length ||
    [availableMinorBySuccessor, priorArrearsMinor].some(
      (values) => Object.keys(values).sort().join(",") !== ids.join(",")
    )
  )
    throw new Error("Continuing service needs every successor budget and arrears balance");
  const successorCallsMinor: Record<string, number> = {};
  const successorContributionsMinor: Record<string, number> = {};
  const successorArrearsMinor: Record<string, number> = {};
  let totalContributionsMinor = 0;
  for (const id of ids) {
    const available = availableMinorBySuccessor[id];
    const prior = priorArrearsMinor[id];
    const call = calls[id] + prior;
    if ([available, prior, call].some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new Error("Continuing service exceeds shared accounting precision");
    const paid = Math.min(call, available);
    successorCallsMinor[id] = call;
    successorContributionsMinor[id] = paid;
    successorArrearsMinor[id] = call - paid;
    totalContributionsMinor += paid;
    if (!Number.isSafeInteger(totalContributionsMinor))
      throw new Error("Continuing contributions exceed shared accounting precision");
  }
  return {
    issuerOwnShareMinor: calls[finances.servicingIssuerId],
    successorCallsMinor,
    successorContributionsMinor,
    successorArrearsMinor,
    totalContributionsMinor,
  };
}
