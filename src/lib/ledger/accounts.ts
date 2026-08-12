import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  FinancialSubjectType,
  FinancialCounterpartyType,
} from "@/lib/db/types/financialTxLog";

/**
 * Shadow-ledger account registry.
 *
 * A small closed set of account KINDS. Each real (non-system) kind maps to
 * exactly ONE authoritative balance field in Mongo — that mapping is the audit
 * surface the stock-vs-flow reconciler check diffs against (see
 * src/lib/ledger/balanceSnapshot.ts). The canonical account id is a
 * colon-delimited string whose LAST segment is always the currency code:
 *
 *   character:<id>:<currency>          personal wallet (currencyBalances.personal.X / cashOnHand)
 *   character_savings:<id>:<currency>  savings balance
 *   corporation:<id>:<currency>        corp liquidCapital
 *   party:<id>:<currency>              party treasury
 *   government:<countryId>:<currency>  federalBudget treasuryBalance
 *   fund:<id>:<currency>               index fund cash leg
 *   org:<id>:<currency>                international org funds
 *   pension_scheme:<id>:<currency>     union pension scheme assets
 *   mint:<reason>:<currency>           system money creation (see plan §1.3)
 *   sink:<reason>:<currency>           system money destruction
 *   fx:<A>/<B>:<currency>              FX translation account (see plan §1.4)
 *
 * See docs/plans/2026-07-05-shadow-ledger-plan.md §1.1.
 */

export type LedgerAccountKind =
  | "character"
  | "character_savings"
  | "corporation"
  | "party"
  | "state_party"
  | "government"
  | "fund"
  | "org"
  | "pension_scheme"
  | "mint"
  | "sink"
  | "fx";

/**
 * The real (balance-backed) kinds the reconciler stock-checks. System kinds
 * (mint/sink/fx) are not stock-checked.
 *
 * `state_party` is a DEFINED real-money account (statePartyOrg.treasury) but is
 * intentionally NOT listed here yet: its treasury is also mutated by
 * still-uninstrumented flows (PS-investment debits, NPP influence spend), so
 * stock-checking it now would manufacture divergences. Phase 3 captures the
 * inbound `party_dues_received` legs against it so the tx rows derive and the
 * money-supply view attributes them; adding it to the stock-check waits on a
 * dedicated PR that instruments the outbound state-party treasury flows too.
 * See docs/plans/2026-07-05-shadow-ledger-plan.md §3.
 */
/**
 * `pension_scheme` is a DEFINED real-money account (PensionScheme.assetsAnchor)
 * and is deliberately NOT stock-checked yet, for the same reason `state_party`
 * is not: its assets will also move through fund subscriptions and benefit
 * payments that are not instrumented yet, so stock-checking it now would
 * manufacture divergences. Defining the account is what makes the employer's
 * contribution derive to a real counterparty instead of reading as a leak;
 * adding it to the stock-check waits on the PR that instruments the rest.
 */
export const REAL_ACCOUNT_KINDS: readonly LedgerAccountKind[] = [
  "character",
  "character_savings",
  "corporation",
  "party",
  "government",
  "fund",
  "org",
] as const;

export function accountId(kind: LedgerAccountKind, ref: string, currency: CurrencyCode): string {
  return `${kind}:${ref}:${currency}`;
}

/** The currency of an account is always its final `:`-delimited segment. */
export function accountCurrency(account: string): string {
  const idx = account.lastIndexOf(":");
  return idx === -1 ? "" : account.slice(idx + 1);
}

export function accountKind(account: string): string {
  const idx = account.indexOf(":");
  return idx === -1 ? account : account.slice(0, idx);
}

export function isRealAccount(account: string): boolean {
  return (REAL_ACCOUNT_KINDS as readonly string[]).includes(accountKind(account));
}

export function isSystemAccount(account: string): boolean {
  const kind = accountKind(account);
  return kind === "mint" || kind === "sink" || kind === "fx";
}

/** Map a financialTxLog subject to a real account id. Returns null when unmappable. */
export function subjectAccount(
  subjectType: FinancialSubjectType,
  ids: { subjectId?: string; countryId?: string; statePartyKey?: string },
  currency: CurrencyCode
): string | null {
  switch (subjectType) {
    case "character":
      return ids.subjectId ? accountId("character", ids.subjectId, currency) : null;
    case "corporation":
      return ids.subjectId ? accountId("corporation", ids.subjectId, currency) : null;
    case "party":
      // National party rows carry an ObjectId subjectId → party treasury account.
      // State-party rows have no ObjectId identity (statePartyOrg is keyed by a
      // composite string in `meta.statePartyKey`) → route to a state_party
      // account so the row still derives. See REAL_ACCOUNT_KINDS note.
      if (ids.subjectId) return accountId("party", ids.subjectId, currency);
      if (ids.statePartyKey) return accountId("state_party", ids.statePartyKey, currency);
      return null;
    case "government":
      return ids.countryId ? accountId("government", ids.countryId, currency) : null;
    case "pension_scheme":
      return ids.subjectId ? accountId("pension_scheme", ids.subjectId, currency) : null;
    default:
      return null;
  }
}

/**
 * Map a financialTxLog counterparty to a real account id, when derivable from a
 * single-entry row. `system` and government counterparties (tx rows carry only
 * `counterpartyId`, never a countryId for the OTHER side) are NOT derivable
 * here — those fall through to a mint/sink contra leg.
 */
export function counterpartyAccount(
  counterpartyType: FinancialCounterpartyType | undefined,
  counterpartyId: string | undefined,
  currency: CurrencyCode
): string | null {
  if (!counterpartyType || counterpartyType === "system") return null;
  if (!counterpartyId) return null;
  switch (counterpartyType) {
    case "character":
      return accountId("character", counterpartyId, currency);
    case "corporation":
      return accountId("corporation", counterpartyId, currency);
    case "party":
      return accountId("party", counterpartyId, currency);
    case "pension_scheme":
      return accountId("pension_scheme", counterpartyId, currency);
    // government counterparties have no countryId on the tx row — not derivable.
    default:
      return null;
  }
}

export function mintSinkAccount(
  subjectAnchorAmount: number,
  reason: string,
  currency: CurrencyCode
): string {
  const kind: LedgerAccountKind = subjectAnchorAmount >= 0 ? "mint" : "sink";
  return accountId(kind, reason, currency);
}
