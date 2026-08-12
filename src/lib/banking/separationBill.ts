import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { type BankingLawDoc, type BankingSeparationPolicy } from "@/lib/banking/separationLaw";

/** Suffix on every reusable banking-separation legislation type id. */
export const BANKING_SEPARATION_TYPE_SUFFIX = "_banking_separation";

export function isBankingSeparationLegislationType(legislationTypeId: string): boolean {
  return legislationTypeId.endsWith(BANKING_SEPARATION_TYPE_SUFFIX);
}

/**
 * Map a policy-option id to a separation policy. Option ids are
 * `${typeId}_separated` / `${typeId}_universal`.
 */
export function separationPolicyFromOptionId(
  policyOptionId: string | undefined
): BankingSeparationPolicy | null {
  if (!policyOptionId) return null;
  if (policyOptionId.endsWith("_separated")) return "separated";
  if (policyOptionId.endsWith("_universal")) return "universal";
  return null;
}

/**
 * Write (or overwrite) the country's banking separation law. Idempotent upsert
 * keyed by countryId. Called from bill enactment when a banking_separation
 * policy provision passes.
 */
export async function applySeparationBill(
  db: Db,
  countryId: CountryId,
  option: BankingSeparationPolicy,
  billId: string,
  turn: number
): Promise<void> {
  if (option !== "separated" && option !== "universal") {
    throw new Error(`Invalid banking separation option: ${String(option)}`);
  }

  const doc: BankingLawDoc = {
    _id: countryId,
    separation: option,
    enactedTurn: turn,
    billId,
  };

  await db
    .collection<BankingLawDoc>("bankingLaws")
    .updateOne({ _id: countryId }, { $set: doc }, { upsert: true });
}
