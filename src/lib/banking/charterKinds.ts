import type { BankCharter } from "@/lib/db/types/bank";
import { charterMay } from "@/lib/banking/rules/capabilities";

/**
 * What a bank charter is allowed to do.
 *
 * There were SIX copies of this rule, in `deposits.ts`, `rates.ts`,
 * `interbank.ts`, `lending.ts`, `bankingTurn.ts` and `bankSolvencyTurn.ts`,
 * five of them byte-identical and one differing only in its type guard. They
 * agreed, so this is not a bug fix; it is removing the chance for the seventh
 * to disagree.
 *
 * The stakes are why it is worth doing. This predicate decides who may hold
 * player deposits, who may originate loans, who lends on the interbank market,
 * who pays deposit interest, and who is exposed to a bank run. A copy that
 * drifted, say by forgetting the `status === "active"` half, would let a
 * revoked bank keep taking deposits in one code path while every other path
 * treated it as closed.
 *
 * Retail and universal charters take deposits; investment charters do not, and
 * run a proprietary book instead. Lending is the same set: the two rules are
 * separate names for one charter distinction, and `isLendingCharter` is kept as
 * an alias rather than folded away so the call sites still read as what they
 * are checking.
 */
export function isDepositTakingCharter(charter: BankCharter | undefined): charter is BankCharter {
  // Structural answer only: the kill switches are checked by the caller, as
  // they always were. The table in `rules/capabilities.ts` is the one place
  // the charter types are named.
  return charterMay(charter, "acceptPlayerDeposits");
}

/**
 * Charters that originate the NPC HOUSEHOLD book.
 *
 * The same set as deposit-taking, and for a real reason rather than an alias:
 * the household book is funded out of the deposit base, so a charter that takes
 * no deposits has nothing to lend households.
 */
export function isLendingCharter(charter: BankCharter | undefined): charter is BankCharter {
  return charterMay(charter, "householdLending");
}

/**
 * Charters that may originate a NAMED loan to a corporation or character.
 *
 * Every active charter, investment included. Underwriting and lending to firms
 * is what an investment bank is FOR, and excluding them was the single largest
 * reason the charter had no viable business.
 *
 * The banking turn services the named loan book of EVERY charter this admits.
 * It used to iterate deposit takers only, so a loan an investment bank was
 * allowed to originate was never advanced: no interest, no principal, no
 * arrears, and the bank still paid margin interest on the cash it had lent.
 *
 * Household lending stays closed to them (see {@link isLendingCharter}); a firm
 * loan is funded from the bank's own capital, which they do have.
 */
export function isNamedLendingCharter(charter: BankCharter | undefined): charter is BankCharter {
  return charterMay(charter, "serviceLoanBook");
}
