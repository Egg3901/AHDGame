/**
 * Loans outstanding to a bank that no longer exists.
 *
 * The banking turn services banks whose charter is `active`, which is correct
 * for everything except the loans a dead bank leaves behind. Those loans were
 * simply never serviced again: the borrower stopped paying, the asset sat on a
 * revoked charter at full value forever, and the money that should have reached
 * the people who lost out when the bank failed reached nobody. Every comment in
 * the wind-up paths said "loans are LEFT IN PLACE and keep amortizing", and
 * none of them did.
 *
 * A loan is an obligation to whoever holds it, and a bank failing does not
 * discharge it. What changes is who the payment is owed to:
 *
 *  - **Before the deposit book is resolved**, it is owed to the bank, and it
 *    lands in the same `cashReserves` the resolution waterfall is about to
 *    distribute. A recovery that arrives in time simply makes the waterfall
 *    bigger, which is exactly what it is for.
 *  - **After resolution has closed**, the claimants are gone: the household
 *    book was made whole by the insurance fund and the treasury behind it, and
 *    the owner has taken whatever residual there was. A late recovery therefore
 *    belongs to the insurer that stood in, so it is paid into the currency's
 *    deposit insurance fund. That is subrogation, and it is the only
 *    destination that does not either strand the money on a dead charter or
 *    hand a windfall to a shareholder who has already been paid out.
 *
 * Both destinations go through the same money primitive under the same per-loan
 * key as a normal servicing pass, so a retried turn cannot charge a borrower
 * twice.
 */

import type { Db } from "mongodb";
import { lifecycleStage, stageAllows } from "@/lib/banking/rules/lifecycle";
import type { Corporation } from "@/lib/db/types";
import type { BankLoan } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { MoneyTarget } from "@/lib/banking/moneyMove";
import { ensureFund } from "@/lib/banking/insurance";

export type DeadBankLoanSummary = {
  /** Loans belonging to a wound-up bank that were serviced this turn. */
  loansServiced: number;
  /** Cash recovered into a bank still awaiting resolution. */
  recoveredToEstate: number;
  /** Cash recovered into the insurance fund after resolution closed. */
  recoveredToInsurer: number;
};

export const ZERO_DEAD_BANK_SUMMARY: DeadBankLoanSummary = {
  loansServiced: 0,
  recoveredToEstate: 0,
  recoveredToInsurer: 0,
};

type DeadBank = {
  corporationId: Corporation["_id"];
  name: string;
  currency: CurrencyCode;
  /** True once the deposit book has been returned and the estate is closed. */
  resolved: boolean;
};

/** Banks whose charter has ended but whose loan book has not. */
export async function findDeadBanksWithLoans(db: Db): Promise<DeadBank[]> {
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ "bankCharter.status": { $in: ["failed", "revoked"] } })
    .project<Pick<Corporation, "_id" | "name" | "bankCharter">>({
      name: 1,
      bankCharter: 1,
    })
    .toArray();

  return corps
    .filter((corp) => corp.bankCharter)
    .map((corp) => ({
      corporationId: corp._id,
      name: corp.name,
      currency: corp.bankCharter!.currency as CurrencyCode,
      // A revoked charter has already run the waterfall on the way out, so its
      // estate is closed the moment it is revoked. A failed one is closed only
      // once the resolution sweep has stamped it.
      resolved: stageAllows(lifecycleStage(corp.bankCharter), "windDownEstate"),
    }));
}

/** Where a payment to this dead bank should land. */
export function recoveryTargetFor(bank: DeadBank): MoneyTarget {
  if (!bank.resolved) {
    return {
      collection: "corporations",
      filter: { _id: bank.corporationId },
      path: "bankCharter.cashReserves",
      note: `recovery into ${bank.name}'s estate, before it is distributed`,
    };
  }
  return {
    collection: "depositInsuranceFunds",
    filter: { _id: bank.currency },
    path: "balance",
    note: `recovery to the insurer that stood behind ${bank.name}`,
  };
}

/**
 * Service every loan still owed to a wound-up bank.
 *
 * `serviceLoan` is injected rather than imported so this module does not depend
 * on the turn file that depends on it, and so the servicing arithmetic stays in
 * exactly one place.
 */
export async function processDeadBankLoans(
  db: Db,
  turn: number,
  serviceLoan: (
    loan: BankLoan,
    bank: DeadBank,
    creditTarget: MoneyTarget
  ) => Promise<{ collected: number }>
): Promise<DeadBankLoanSummary> {
  const summary: DeadBankLoanSummary = { ...ZERO_DEAD_BANK_SUMMARY };
  const deadBanks = await findDeadBanksWithLoans(db);
  if (deadBanks.length === 0) return summary;

  for (const bank of deadBanks) {
    const loans = await db
      .collection<BankLoan>("bankLoans")
      .find({
        bankCorporationId: bank.corporationId,
        borrowerType: { $in: ["character", "corporation"] },
        status: { $in: ["current", "arrears"] },
        lastProcessedTurn: { $ne: turn },
      })
      .toArray();
    if (loans.length === 0) continue;

    const target = recoveryTargetFor(bank);
    if (bank.resolved) {
      // The fund document has to exist before anything is paid into it: a
      // recovery credited to a missing fund is money that silently stops
      // existing, which is the whole class of bug this work is about.
      await ensureFund(db, bank.currency);
    }

    // Serial per bank: two loans from the same borrower must see each other's
    // debit, exactly as the live path does.
    for (const loan of loans) {
      const { collected } = await serviceLoan(loan, bank, target);
      summary.loansServiced += 1;
      if (bank.resolved) summary.recoveredToInsurer += collected;
      else summary.recoveredToEstate += collected;
    }
  }

  return summary;
}

export type { DeadBank };
