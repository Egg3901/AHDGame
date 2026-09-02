import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";

/**
 * Append-only audit log of treasury inflows and outflows for the chair
 * surface. The system-level forensic ledger lives in `financialTxLogs`;
 * this collection is the curated, party-scoped view a chair sees on the
 * Treasury tab — same events, simpler categories, smaller filter set.
 *
 * Each row matches a single `$inc` against a treasury balance (party,
 * caucus, or state-party). `amount` is always positive; `direction`
 * tells you whether it added to or removed from the balance.
 */

export type TreasuryHolderType = "party" | "caucus" | "state_party";

export type TreasuryTransactionDirection = "credit" | "debit";

/**
 * Every treasury-transaction category, as a runtime value.
 *
 * The union below is DERIVED from this tuple rather than declared separately, so
 * consumers that need the list at runtime (the API's accepted-filter list, the
 * treasury log's category dropdown) read the same source the type comes from.
 * They used to keep their own hand-maintained copies, which drifted:
 * `ps_investment` was offered by the log's dropdown but missing from the route's
 * accepted list, and because an unrecognised `category` is dropped rather than
 * rejected, selecting it silently returned every category instead of filtering.
 *
 * Add a category here and nowhere else.
 */
export const TREASURY_TRANSACTION_CATEGORIES = [
  "donations",
  "caucus_tax",
  "transfers",
  "slate",
  "gotv",
  "suppression",
  "whip_ops",
  "recruitment",
  "operations",
  "fund_generation",
  "ps_investment",
  "org_building",
  "campaign_donation",
] as const;

export type TreasuryTransactionCategory = (typeof TREASURY_TRANSACTION_CATEGORIES)[number];

export interface TreasuryTransaction {
  _id: ObjectId;

  /** Type of holder that owns this row. Determines which `holderId` collection to look up. */
  holderType: TreasuryHolderType;

  /**
   * Holder identifier:
   *   - `party`: PoliticalParty.sequentialId (string), matching the partyId
   *     encoding used elsewhere
   *   - `caucus`: Caucus._id (ObjectId stringified)
   *   - `state_party`: StatePartyOrg._id keyed string (e.g. "US_CA_1")
   */
  holderId: string;

  countryId: CountryId;
  /** Party sequential id this row rolls up to, for joined queries. */
  partyId: string;

  category: TreasuryTransactionCategory;
  direction: TreasuryTransactionDirection;
  /** Currency-units, always positive. Sign is on `direction`. */
  amount: number;
  /**
   * ISO 4217 code for the `amount` field — always the holder's home currency
   * post-cf-inconsistency-fix Phase 6 (treasuries became local). Omitted on
   * pre-2026-05-18 rows, which are denominated in anchor units (₳) and
   * intentionally NOT backfilled: a blind backfill from `countryId` would
   * mis-label historical anchor rows as local-currency rows. UI consumers
   * fall back to ₳ when this field is missing.
   */
  currencyCode?: CurrencyCode;

  /**
   * Free-form short label shown on the audit row. Kept short — long-form
   * details belong in the underlying domain log (financialTxLogs).
   */
  memo: string;

  /**
   * Counterparty handle, optional. For transfers/sends the receiving (or
   * sending) party id; for donations, the donor character id; for slate
   * spends, the SlateCandidate row id, etc.
   */
  counterparty?: {
    type: "party" | "state_party" | "caucus" | "character" | "campaign" | "system";
    id: string;
    label?: string;
  };

  /**
   * Optional actor metadata for chair-surface audit rows. Used when a player
   * action initiates the transfer and the UI should show who triggered it.
   */
  initiatedBy?: {
    type: "character" | "system";
    id: string;
    label?: string;
  };

  /** Game turn the event happened on. */
  turn: number;

  /** When this row was emitted. Distinct from `turn` for sub-turn ordering. */
  createdAt: Date;
}
