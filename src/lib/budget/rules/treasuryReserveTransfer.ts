import { TREASURY_TRANSFER_MAX_PER_TURN_FRACTION } from "@/lib/constants/currencies";

/** A reserve transfer exchanges two home-currency positions once, without changing appropriations. */
export function validateTreasuryReserveTransfer(input: {
  amount: number;
  annualRevenue: number;
  annualSpending: number;
  debtCeiling: number | null | undefined;
}): string | undefined {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "Amount must be positive";
  const cap = input.annualRevenue * TREASURY_TRANSFER_MAX_PER_TURN_FRACTION;
  if (input.amount > cap)
    return `Transfer exceeds per-turn cap (${TREASURY_TRANSFER_MAX_PER_TURN_FRACTION * 100}% of annual revenue = ${cap.toFixed(0)}).`;
  if (
    typeof input.debtCeiling === "number" &&
    input.annualRevenue - input.annualSpending - input.amount < -input.debtCeiling
  )
    return "Transfer would breach the federal debt ceiling.";
}
