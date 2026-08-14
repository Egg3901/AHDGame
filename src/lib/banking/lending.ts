import { ObjectId, type Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { Character, Corporation } from "@/lib/db/types";
import type { IndexFund } from "@/lib/db/types/indexFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { isBlockedBorrower, type ResolveFundConstituents } from "@/lib/banking/blacklist";
import { getEffectiveBankRates } from "@/lib/banking/rates";
import { getLendableHeadroom, getReserveRequirement } from "@/lib/banking/reserves";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/currentTurn";
import { isLendingCharter, isNamedLendingCharter } from "./charterKinds";

/** Provisional - character loan rate = posted lending rate + this spread (pp). */
export const CHARACTER_LOAN_SPREAD_PP = 1.5;

/** Provisional - character loan principal cap as a fraction of liquid personal in loan currency. */
export const CHARACTER_BORROWER_CAP_FRACTION = 0.25;

/** Provisional - corporation loan principal cap as a fraction of liquidCapital. */
export const CORP_BORROWER_CAP_FRACTION = 0.5;

/** Provisional - each pp of lending rate above this reference shrinks NPC volume. */
export const NPC_LOAN_BOOK_RATE_REFERENCE_PERCENT = 4;

/** Provisional - volume sensitivity per pp above the rate reference. */
export const NPC_LOAN_BOOK_RATE_SENSITIVITY = 0.08;

/** Provisional - floor on the NPC volume rate factor. */
export const NPC_LOAN_BOOK_VOLUME_FACTOR_MIN = 0.2;

/** NPC household borrowing cannot exceed the bank's lendable deposits. */
export const NPC_LOAN_BOOK_VOLUME_FACTOR_MAX = 1;

/** Provisional - base expected default rate (percent) at the default reference rate. */
export const NPC_LOAN_BOOK_DEFAULT_BASE_PERCENT = 1.0;

/** Provisional - each pp of lending rate above this reference raises expected defaults. */
export const NPC_LOAN_BOOK_DEFAULT_RATE_REFERENCE_PERCENT = 6;

/** Provisional - default-rate sensitivity per pp above the default reference. */
export const NPC_LOAN_BOOK_DEFAULT_SENSITIVITY = 0.5;

/** Provisional - floor on expected NPC default rate (percent). */
export const NPC_LOAN_BOOK_DEFAULT_MIN_PERCENT = 0.5;

/** Provisional - ceiling on expected NPC default rate (percent). */
export const NPC_LOAN_BOOK_DEFAULT_MAX_PERCENT = 12;

export type LoanBorrower = {
  type: "corporation" | "character";
  id: ObjectId;
};

export type OriginateLoanResult =
  { ok: true; loan: BankLoan; pending?: boolean } | { ok: false; error: string };

export type NpcLoanBook = {
  volume: number;
  expectedDefaultRatePercent: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function buildFundConstituentResolver(
  db: Db,
  fundIds: readonly string[] | undefined
): Promise<ResolveFundConstituents> {
  if (!fundIds || fundIds.length === 0) {
    return () => [];
  }

  const funds = await db
    .collection<IndexFund>("indexFunds")
    .find({ slug: { $in: [...fundIds] } })
    .project({ slug: 1, targetConstituents: 1 })
    .toArray();

  const bySlug = new Map<string, string[]>();
  for (const fund of funds) {
    const constituents = fund.targetConstituents ?? [];
    bySlug.set(
      fund.slug,
      constituents.map((c: { corporationId: ObjectId }) => c.corporationId.toString())
    );
  }

  return (fundId: string) => bySlug.get(fundId) ?? [];
}

/**
 * Originate a named player loan. Objective auto-approval (no seat).
 *
 * Writes the BankLoan doc first, then $inc's charter.totalLoans and credits
 * the borrower. On any failure after insert, deletes the loan (and reverses
 * a successful totalLoans $inc) as compensation. Standalone Mongo - no txn.
 */
export async function originateLoan(
  db: Db,
  bankCorporationId: ObjectId,
  borrower: LoanBorrower,
  principal: number,
  termTurns: number
): Promise<OriginateLoanResult> {
  if (!(await isPrivateBankingEnabled())) {
    return { ok: false, error: "Private banking is not enabled" };
  }

  if (!Number.isFinite(principal) || principal <= 0) {
    return { ok: false, error: "Principal must be a positive number" };
  }
  if (!Number.isFinite(termTurns) || termTurns < 4 || termTurns > 120) {
    return { ok: false, error: "termTurns must be an integer from 4 to 120" };
  }
  if (!Number.isInteger(termTurns)) {
    return { ok: false, error: "termTurns must be an integer from 4 to 120" };
  }

  if (borrower.type === "corporation" && borrower.id.equals(bankCorporationId)) {
    return { ok: false, error: "A bank cannot lend to itself" };
  }

  const bankCorp = await db.collection<Corporation>("corporations").findOne({
    _id: bankCorporationId,
  });
  if (!bankCorp) {
    return { ok: false, error: "Bank corporation not found" };
  }

  const charter = bankCorp.bankCharter;
  // Named loans are open to every active charter. Investment banks lend to
  // firms; only the household book is closed to them.
  if (!isNamedLendingCharter(charter)) {
    return { ok: false, error: "Corporation has no active bank charter" };
  }
  if (borrower.type === "character" && !isLendingCharter(charter)) {
    return {
      ok: false,
      error: "An investment charter lends to corporations, not to individuals",
    };
  }

  const currency = charter.currency as CurrencyCode;
  const resolveFunds = await buildFundConstituentResolver(db, charter.blacklist?.indexFundIds);

  let borrowerCap = 0;
  // Captured for the ledger leg below: a tx row with no subject name is
  // unreadable in the surfaces that consume it.
  let borrowerName = "Borrower";

  if (borrower.type === "character") {
    const character = await db.collection<Character>("characters").findOne({ _id: borrower.id });
    if (!character) {
      return { ok: false, error: "Borrower character not found" };
    }
    borrowerName = character.name ?? "Borrower";
    if (isBlockedBorrower(charter, { characterId: borrower.id.toString() }, resolveFunds)) {
      return { ok: false, error: "Borrower is on the bank's blacklist" };
    }
    // Cheap cap: liquid personal in the loan currency (no full net-worth walk).
    const personal = character.currencyBalances?.personal?.[currency] ?? 0;
    borrowerCap = CHARACTER_BORROWER_CAP_FRACTION * Math.max(0, personal);
  } else {
    const corp = await db.collection<Corporation>("corporations").findOne({ _id: borrower.id });
    if (!corp) {
      return { ok: false, error: "Borrower corporation not found" };
    }
    borrowerName = corp.name ?? "Borrower";
    if (isBlockedBorrower(charter, { corporationId: borrower.id.toString() }, resolveFunds)) {
      return { ok: false, error: "Borrower is on the bank's blacklist" };
    }
    const corpCurrency = resolveCorpLiquidCurrencyCode(corp);
    if (corpCurrency !== currency) {
      return {
        ok: false,
        error: `Loan currency ${currency} does not match corporation treasury currency ${corpCurrency ?? "unknown"}`,
      };
    }
    borrowerCap = CORP_BORROWER_CAP_FRACTION * Math.max(0, corp.liquidCapital ?? 0);
  }

  const reserveRatio = await getReserveRequirement(db, currency);
  const headroom = getLendableHeadroom(charter, reserveRatio);
  if (principal > headroom) {
    return { ok: false, error: "Principal exceeds lendable headroom" };
  }
  if (principal > borrowerCap) {
    return { ok: false, error: "Principal exceeds borrower capacity cap" };
  }

  const rates = await getEffectiveBankRates(db, charter);
  const ratePercent =
    borrower.type === "character"
      ? rates.lendingRatePercent + CHARACTER_LOAN_SPREAD_PP
      : rates.lendingRatePercent;

  const loanId = new ObjectId();
  const originatedTurn = await getCurrentTurn(db);

  // Opt-in approval: park the loan as `pending` with no money movement. The CEO
  // accepts or rejects it from the console; acceptance runs the same disbursement
  // path below via `disburseNamedLoan`. See `banking/loanApproval.ts`.
  if (charter.requireApproval === true) {
    const pendingLoan: BankLoan = {
      _id: loanId,
      bankCorporationId,
      currency,
      borrowerType: borrower.type,
      borrowerId: borrower.id,
      principal,
      outstanding: principal,
      ratePercent,
      originatedTurn,
      termTurns,
      status: "pending",
      requestedTurn: originatedTurn,
    };
    try {
      await db.collection<BankLoan>("bankLoans").insertOne(pendingLoan);
    } catch {
      return { ok: false, error: "Failed to write loan document" };
    }
    return { ok: true, loan: pendingLoan, pending: true };
  }

  const loan: BankLoan = {
    _id: loanId,
    bankCorporationId,
    currency,
    borrowerType: borrower.type,
    borrowerId: borrower.id,
    principal,
    outstanding: principal,
    ratePercent,
    originatedTurn,
    termTurns,
    status: "current",
  };

  try {
    await db.collection<BankLoan>("bankLoans").insertOne(loan);
  } catch {
    return { ok: false, error: "Failed to write loan document" };
  }

  const disbursed = await disburseNamedLoan(db, {
    loan,
    bankCorporationId,
    bankName: bankCorp.name,
    borrowerName,
  });
  if (!disbursed.ok) {
    await db.collection<BankLoan>("bankLoans").deleteOne({ _id: loanId });
    return disbursed;
  }

  return { ok: true, loan };
}

/**
 * Move the money for a named loan whose doc is already inserted: $inc the bank's
 * loan book, credit the borrower, and emit the origination ledger leg. On any
 * failure it reverses whatever it did (bank $inc) and returns an error WITHOUT
 * deleting the loan doc — the caller owns the doc lifecycle (auto-origination
 * deletes it; approval reverts it to `pending`). Standalone Mongo, no txn.
 */
export async function disburseNamedLoan(
  db: Db,
  args: {
    loan: Pick<
      BankLoan,
      "_id" | "currency" | "borrowerType" | "borrowerId" | "principal" | "ratePercent" | "termTurns"
    >;
    bankCorporationId: ObjectId;
    bankName: string;
    borrowerName: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { loan, bankCorporationId, bankName, borrowerName } = args;
  const { currency, principal } = loan;
  const borrowerId = loan.borrowerId;
  if (!borrowerId) return { ok: false, error: "Loan has no borrower" };

  const bankInc = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: bankCorporationId,
      "bankCharter.status": "active",
      "bankCharter.type": { $in: ["retail", "universal"] },
    },
    {
      $inc: { "bankCharter.totalLoans": principal },
      $set: { updatedAt: new Date() },
    }
  );

  if (bankInc.matchedCount !== 1) {
    return { ok: false, error: "Failed to update bank loan book" };
  }

  let creditOk = false;
  if (loan.borrowerType === "character") {
    const credit = await db.collection<Character>("characters").updateOne(
      { _id: borrowerId },
      {
        $inc: { [`currencyBalances.personal.${currency}`]: principal },
        $set: { updatedAt: new Date() },
      }
    );
    creditOk = credit.matchedCount === 1;
  } else {
    const credit = await db.collection<Corporation>("corporations").updateOne(
      { _id: borrowerId },
      {
        $inc: { liquidCapital: principal },
        $set: { updatedAt: new Date() },
      }
    );
    creditOk = credit.matchedCount === 1;
  }

  if (!creditOk) {
    await db.collection<Corporation>("corporations").updateOne(
      { _id: bankCorporationId },
      {
        $inc: { "bankCharter.totalLoans": -principal },
        $set: { updatedAt: new Date() },
      }
    );
    return { ok: false, error: "Failed to credit borrower" };
  }

  const originatedTurn = await getCurrentTurn(db);
  // The release review's P1: origination moved money with zero ledger legs. On
  // transactionless Mongo the log IS the journal, so the compensating-write
  // strategy the rollback above implements had nothing to compensate against.
  //
  // Counterparty is `system`, deliberately, so the row derives a MINT contra
  // rather than a debit on the bank. Lending creates deposit money: the bank's
  // own `liquidCapital` is untouched here, only `bankCharter.totalLoans` moves.
  // Naming the bank as counterparty would book a cash outflow that never
  // happened and read as the bank losing the money it just lent.
  await emitTx(db, {
    type: "bank_loan_origination",
    turn: originatedTurn,
    createdAt: new Date(),
    ...(loan.borrowerType === "character"
      ? {
          subjectType: "character" as const,
          subjectId: borrowerId,
          subjectName: borrowerName,
        }
      : {
          subjectType: "corporation" as const,
          subjectId: borrowerId,
          subjectName: borrowerName,
        }),
    amount: principal,
    currencyCode: currency,
    counterpartyType: "system",
    counterpartyName: bankName,
    meta: {
      loanId: loan._id.toString(),
      bankCorporationId: bankCorporationId.toString(),
      ratePercent: loan.ratePercent,
      termTurns: loan.termTurns,
    },
  });

  return { ok: true };
}

/**
 * Pure NPC household loan-book math. Wiring happens in bankingTurn (phase 4).
 *
 * volume = lendableDeposits * clamp(1 - (rate - RATE_REF) * SENS, VOL_MIN, VOL_MAX)
 * expectedDefaultRatePercent = clamp(BASE + max(0, rate - DEF_REF) * DEF_SENS, DEF_MIN, DEF_MAX)
 */
export function computeNpcLoanBook(
  lendableDeposits: number,
  lendingRatePercent: number
): NpcLoanBook {
  const funding = Number.isFinite(lendableDeposits) && lendableDeposits > 0 ? lendableDeposits : 0;
  const rate = Number.isFinite(lendingRatePercent) ? lendingRatePercent : 0;

  const volumeFactor = clamp(
    1 - (rate - NPC_LOAN_BOOK_RATE_REFERENCE_PERCENT) * NPC_LOAN_BOOK_RATE_SENSITIVITY,
    NPC_LOAN_BOOK_VOLUME_FACTOR_MIN,
    NPC_LOAN_BOOK_VOLUME_FACTOR_MAX
  );
  const volume = funding * volumeFactor;

  const expectedDefaultRatePercent = clamp(
    NPC_LOAN_BOOK_DEFAULT_BASE_PERCENT +
      Math.max(0, rate - NPC_LOAN_BOOK_DEFAULT_RATE_REFERENCE_PERCENT) *
        NPC_LOAN_BOOK_DEFAULT_SENSITIVITY,
    NPC_LOAN_BOOK_DEFAULT_MIN_PERCENT,
    NPC_LOAN_BOOK_DEFAULT_MAX_PERCENT
  );

  return { volume, expectedDefaultRatePercent };
}

/**
 * Pure helper: apply a payment against outstanding. Returns the field set to
 * $set / merge onto the loan doc (used by bankingTurn in phase 4).
 */
export function applyLoanPayment(
  loan: Pick<BankLoan, "outstanding" | "status">,
  payment: number
): Pick<BankLoan, "outstanding" | "status"> {
  const pay = Number.isFinite(payment) && payment > 0 ? payment : 0;
  const nextOutstanding = Math.max(0, (loan.outstanding ?? 0) - pay);
  return {
    outstanding: nextOutstanding,
    status: nextOutstanding <= 0 ? "repaid" : loan.status === "arrears" ? "current" : loan.status,
  };
}

/**
 * Pure helper: mark a loan defaulted. Returns the field set for the loan doc.
 */
export function markLoanDefaulted(
  loan: Pick<BankLoan, "outstanding" | "status">
): Pick<BankLoan, "outstanding" | "status"> {
  return {
    outstanding: loan.outstanding,
    status: "defaulted",
  };
}
