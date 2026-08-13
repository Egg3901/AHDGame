import type { BankCharter } from "@/lib/db/types/bank";

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
  return (
    charter != null &&
    charter.status === "active" &&
    (charter.type === "retail" || charter.type === "universal")
  );
}

/**
 * Charters that originate loans. The same set as deposit-taking today, named
 * separately because the call sites are asking a different question and a
 * future charter type could answer them differently.
 */
export function isLendingCharter(charter: BankCharter | undefined): charter is BankCharter {
  return isDepositTakingCharter(charter);
}
