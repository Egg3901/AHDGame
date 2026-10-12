import { expenseFeeForTurn, FEE_SUSPENDED_BELOW_BACKING_RATIO } from "../constants";

export function feeDecision(params: {
  status: string;
  expenseRatioAnnual: number | undefined;
  aumAnchor: number;
  backingRatio: number | undefined;
  cashAnchor: number;
}): { feeAnchor: number; reason?: "not_sponsored" | "winding_down" | "impaired" | "no_cash" } {
  if (!params.expenseRatioAnnual || params.expenseRatioAnnual <= 0)
    return { feeAnchor: 0, reason: "not_sponsored" };
  if (params.status !== "active") return { feeAnchor: 0, reason: "winding_down" };
  if (
    typeof params.backingRatio === "number" &&
    params.backingRatio < FEE_SUSPENDED_BELOW_BACKING_RATIO
  )
    return { feeAnchor: 0, reason: "impaired" };
  const feeAnchor = expenseFeeForTurn(params.aumAnchor, params.expenseRatioAnnual);
  if (feeAnchor <= 0) return { feeAnchor: 0 };
  if (params.cashAnchor < feeAnchor) return { feeAnchor: 0, reason: "no_cash" };
  return { feeAnchor };
}

/** Cash is already part of backing. Pending burned units still own backing. */
export function markedFundBacking(input: {
  cashAnchor: number;
  stockValueAnchor: number;
  bondValueAnchor: number;
  orderEscrowAnchor: number;
}): number {
  const amounts = Object.values(input);
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 0))
    throw new Error("Invalid fund backing");
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

/** No whole-currency rounding: both money legs retain the same anchor value. */
export function sponsorSeedUnits(seedAnchor: number, initialNav: number): number {
  if (
    !Number.isFinite(seedAnchor) ||
    seedAnchor <= 0 ||
    !Number.isFinite(initialNav) ||
    initialNav <= 0
  )
    throw new Error("Invalid sponsor seed");
  return seedAnchor / initialNav;
}

export function sponsorUnitsLocked(input: {
  accounting: "legacy_residual" | "paid_units" | undefined;
  isSponsor: boolean;
  otherHolders: number;
  pendingWithdrawals: number;
}): boolean {
  return (
    input.accounting === "paid_units" &&
    input.isSponsor &&
    (input.otherHolders > 0 || input.pendingWithdrawals > 0)
  );
}
