/**
 * Investment and universal banks can manage pooled funds. Retail banks cannot.
 * bankMayManageFunds also checks a proposed charter when a sponsor becomes a bank.
 */
import type { BankCharter } from "@/lib/db/types/bank";

export function bankMayManageFunds(
  charter: Pick<BankCharter, "status" | "type"> | undefined
): boolean {
  return (
    charter?.status === "active" && (charter.type === "investment" || charter.type === "universal")
  );
}

export function fundSponsorEligibility(input: {
  hasFinancialSector: boolean;
  bankCharter?: Pick<BankCharter, "status" | "type">;
}): string | null {
  if (!input.hasFinancialSector)
    return "Only a corporation with a financial sector can sponsor a fund.";
  if (input.bankCharter && !bankMayManageFunds(input.bankCharter))
    return "Only banks with an active investment or universal charter can manage funds.";
  return null;
}
