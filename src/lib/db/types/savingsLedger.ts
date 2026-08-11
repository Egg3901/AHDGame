import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type SavingsLedgerType = "open" | "deposit" | "withdraw" | "interest";

/** Append-only log of savings account activity (per character, per currency). */
export interface SavingsLedgerEntry {
  _id: ObjectId;
  characterId: ObjectId;
  /** Central bank jurisdiction for this currency (US→USD, etc.) */
  countryId: CountryId;
  currencyCode: CurrencyCode;
  type: SavingsLedgerType;
  /** Absolute amount (interest/deposit/withdrawn); open uses 0 */
  amount: number;
  balanceAfter: number;
  turn?: number;
  createdAt: Date;
}
