import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { currencyAmount } from "./reconciliation";

export function includedAuthorityPerTurn(annualAuthority: number): number {
  return Math.round(currencyAmount(annualAuthority, "annualAuthority") / TURNS_PER_YEAR);
}
