import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { LocPaymentMode } from "./character";

export type LocLedgerType =
  | "open"
  | "draw"
  | "repay"
  | "interest"
  | "auto_payment"
  | "garnishment"
  | "distress_drain"
  | "freeze"
  | "unfreeze"
  | "admin_forgive"
  | "paymode_change";

/** Sources that feed a `distress_drain` row when a frozen borrower's idle balances are pulled into the LOC. */
export type LocDistressDrainSource = "savings" | "campaign";

export type LocGarnishmentSource = "ceo_dividend" | "bond_coupon";

/** Append-only log of line-of-credit activity per character / currency. */
export interface LocLedgerEntry {
  _id: ObjectId;
  characterId: ObjectId;
  countryId: CountryId;
  currencyCode: CurrencyCode;
  type: LocLedgerType;
  /** Absolute amount in account currency (interest accrued, repayment, draw, etc.) */
  amount: number;
  /**
   * Interest portion of a payment (`repay` / `auto_payment`). Absent on non-payment types.
   * `amount === interestPortion + principalPortion` when both are populated.
   */
  interestPortion?: number;
  /** Principal portion of a payment (`repay` / `auto_payment`). Absent on non-payment types. */
  principalPortion?: number;
  balanceAfter: number;
  arrearsAfter: number;
  turn?: number;
  createdAt: Date;
  /** e.g. income internal applied, prime/spread snapshot */
  meta?: {
    incomeInternalApplied?: number;
    primePercent?: number;
    spreadPercentPoints?: number;
    distress?: boolean;
    garnishmentSource?: LocGarnishmentSource;
    /** Total income internal units consumed by garnishment this turn (across all source currencies). */
    garnishedInternal?: number;
    /** Set on entries created by admin actions (forgive, force-unfreeze). */
    adminAction?: boolean;
    /** Source currencies auto-converted to fund this payment, mapped to face-value amount used. */
    crossConverted?: Partial<Record<CurrencyCode, number>>;
    /** For `distress_drain` rows: per-source face-value contribution to the drained amount. */
    drainSources?: Partial<Record<LocDistressDrainSource, Partial<Record<CurrencyCode, number>>>>;
    /** Payment mode in effect when this entry was written (for interest/auto_payment audit). */
    paymentMode?: LocPaymentMode;
    /** Extra spread (percentage points) added because the account was on I/O. 0 or undefined when on P/I. */
    ioSurchargePoints?: number;
    /** Previous mode on `paymode_change` rows. */
    from?: LocPaymentMode;
    /** New mode on `paymode_change` rows. */
    to?: LocPaymentMode;
  };
}
