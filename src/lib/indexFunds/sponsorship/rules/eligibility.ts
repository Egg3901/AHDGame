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

/**
 * The charter that counts for fund sponsorship. A revoked charter is history,
 * not a bank: the company sponsors funds like any other financial
 * corporation. Without this, a revoked bank could never sponsor any fund,
 * while a company that never held a charter could charter a Global one.
 */
export function fundBankCharter<T extends Pick<BankCharter, "status">>(
  charter: T | undefined
): T | undefined {
  return charter && charter.status !== "revoked" ? charter : undefined;
}

export function fundSponsorEligibility(input: {
  hasFinancialSector: boolean;
  bankCharter?: Pick<BankCharter, "status" | "type">;
}): string | null {
  if (!input.hasFinancialSector)
    return "Only a corporation with a financial sector can sponsor a fund.";
  const charter = fundBankCharter(input.bankCharter);
  if (charter && !bankMayManageFunds(charter))
    return "Only banks with an active investment or universal charter can manage funds.";
  return null;
}
