import { ObjectId, type Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { Character, Corporation } from "@/lib/db/types";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import type { IndexFund } from "@/lib/db/types/indexFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { isBlockedBorrower, type ResolveFundConstituents } from "@/lib/banking/blacklist";
import { getEffectiveBankRates } from "@/lib/banking/rates";
import { getLendableHeadroom, getReserveRequirement } from "@/lib/banking/reserves";
import { getCashReserves } from "@/lib/banking/bankCash";
import {
  CHARACTER_LOAN_SPREAD_PP,
  CORP_INCOME_AVERAGING_TURNS,
  bindingNamedLoanCap,
  convertFaceBetweenCurrencies,
  maxPrincipalFromIncome,
  namedLoanPaymentDue,
  namedLoanPrincipalCap,
  remainingLoanTurns,
} from "@/lib/banking/lendingMath";
import {
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { estimatePerTurnCurrencyIncomeHomeFace } from "@/lib/lineOfCredit/currencyIncomeEstimate";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/currentTurn";
import { isNamedLendingCharter } from "./charterKinds";
import { charterMay } from "@/lib/banking/rules/capabilities";

export { CHARACTER_LOAN_SPREAD_PP };

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

export type LoanCreditDestination = "personalCash" | "corporationLiquidCapital";

export type OriginateLoanResult =
  | {
      ok: true;
      loan: BankLoan;
      /** True when the bank requires approval: the loan is `pending`, no money moved. */
      pending?: boolean;
      creditedTo: { kind: "character" | "corporation"; name: string };
    }
  | { ok: false; error: string };

export type BorrowerFacingLoan = {
  id: string;
  bankCorporationId: string;
  bankName: string;
  bankSequentialId: number | null;
  currency: CurrencyCode;
  borrowerType: "character" | "corporation";
  borrowerId: string | null;
  borrowerName: string;
  creditedTo: LoanCreditDestination;
  principal: number;
  outstanding: number;
  ratePercent: number;
  originatedTurn: number;
  termTurns: number;
  status: BankLoan["status"];
};

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

function formatCap(n: number): string {
  return String(Math.floor(Math.max(0, n)));
}

function capExceededError(bind: ReturnType<typeof bindingNamedLoanCap>, cap: number): string {
  const max = formatCap(cap);
  if (bind === "cashReserves") {
    return `Principal exceeds the bank's cash reserves (max ${max})`;
  }
  if (bind === "headroom") {
    return `Principal exceeds lendable headroom (max ${max})`;
  }
  return `Principal exceeds borrower income limit (max ${max})`;
}

export async function averageCorpIncomePerTurn(
  db: Db,
  corporationId: ObjectId,
  currentTurn: number
): Promise<number> {
  const windowStart = Math.max(1, currentTurn - CORP_INCOME_AVERAGING_TURNS + 1);
  const rows = await db
    .collection<Pick<CorporationHistory, "income">>("corporationHistory")
    .find({
      corporationId,
      turn: { $gte: windowStart, $lte: currentTurn },
    })
    .project({ income: 1 })
    .toArray();
  if (rows.length === 0) return 0;
  let sum = 0;
  for (const row of rows) {
    if (typeof row.income === "number" && Number.isFinite(row.income)) sum += row.income;
  }
  return Math.max(0, sum / rows.length);
}

async function committedNamedLoanPaymentPerTurn(
  db: Db,
  borrower: LoanBorrower,
  currentTurn: number
): Promise<number> {
  const loans = await db
    .collection<Pick<BankLoan, "outstanding" | "ratePercent" | "originatedTurn" | "termTurns">>(
      "bankLoans"
    )
    .find({
      borrowerType: borrower.type,
      borrowerId: borrower.id,
      status: { $in: ["current", "arrears"] },
    })
    .project({ outstanding: 1, ratePercent: 1, originatedTurn: 1, termTurns: 1 })
    .toArray();
  let sum = 0;
  for (const loan of loans) {
    sum += namedLoanPaymentDue(
      loan.outstanding,
      loan.ratePercent,
      remainingLoanTurns(loan.originatedTurn, loan.termTurns, currentTurn)
    );
  }
  return sum;
}

export async function characterIncomeInLoanCurrency(
  db: Db,
  character: Character,
  loanCurrency: CurrencyCode
): Promise<number> {
  const rates = await loadFxRatesByCurrency(db);
  const rateMap: Partial<Record<CurrencyCode, number>> = {};
  for (const [code, rate] of rates) rateMap[code] = rate;
  const homeFace = await estimatePerTurnCurrencyIncomeHomeFace(db, character, rateMap);
  const home = getHomeCurrency(character);
  return convertFaceBetweenCurrencies(
    homeFace,
    home,
    loanCurrency,
    rates.get(home) ?? 0,
    rates.get(loanCurrency) ?? 0
  );
}

/**
 * Cash a bank may put behind a NEW named loan.
 *
 * A bank funded by deposits lends the lendable share of its deposit base after
 * the reserve requirement and the loans already out. A bank with no deposit
 * base (an investment charter) lends its own cash less what it has lent. One
 * rule, read by origination and by the CEO's later approval alike: the
 * approval path used to apply the deposit rule to every charter, so a loan an
 * investment bank had been allowed to park as pending could never be accepted.
 */
export function namedLoanHeadroom(
  charter: Pick<BankCharter, "type" | "status" | "npcDeposits" | "totalLoans" | "cashReserves">,
  reserveRatio: number
): number {
  if (charterMay(charter, "acceptNpcFunding")) {
    return getLendableHeadroom(charter, reserveRatio);
  }
  return Math.max(0, getCashReserves(charter) - Math.max(0, charter.totalLoans ?? 0));
}

/**
 * Originate a named player loan. Objective auto-approval (no seat).
 *
 * Writes the BankLoan doc first, then $inc's charter.totalLoans and credits
 * the borrower. On any failure after insert, deletes the loan (and reverses
 * a successful totalLoans $inc) as compensation. Standalone Mongo - no txn.
 *
 * Bank-side cap is the ring-fenced vault (`cashReserves`), not the holding
 * company's `liquidCapital`. Borrower-side cap is demonstrated income DTI,
 * not cash already on hand.
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
  if (borrower.type === "character" && !charterMay(charter, "namedCharacterLending")) {
    return {
      ok: false,
      error: "An investment charter lends to corporations, not to individuals",
    };
  }

  const currency = charter.currency as CurrencyCode;
  const originatedTurn = await getCurrentTurn(db);
  const resolveFunds = await buildFundConstituentResolver(db, charter.blacklist?.indexFundIds);

  // Captured for the ledger leg below: a tx row with no subject name is
  // unreadable in the surfaces that consume it.
  let borrowerName = "Borrower";
  let incomePerTurn = 0;

  if (borrower.type === "character") {
    const character = await db.collection<Character>("characters").findOne({ _id: borrower.id });
    if (!character) {
      return { ok: false, error: "Borrower character not found" };
    }
    borrowerName = character.name ?? "Borrower";
    if (isBlockedBorrower(charter, { characterId: borrower.id.toString() }, resolveFunds)) {
      return { ok: false, error: "Borrower is on the bank's blacklist" };
    }
    incomePerTurn = await characterIncomeInLoanCurrency(db, character, currency);
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
    incomePerTurn = await averageCorpIncomePerTurn(db, borrower.id, originatedTurn);
  }

  const rates = await getEffectiveBankRates(db, charter);
  const ratePercent =
    borrower.type === "character"
      ? rates.lendingRatePercent + CHARACTER_LOAN_SPREAD_PP
      : rates.lendingRatePercent;

  const reserveRatio = await getReserveRequirement(db, currency);
  const cashReserves = getCashReserves(charter);
  const headroom = namedLoanHeadroom(charter, reserveRatio);
  const committedPaymentPerTurn = await committedNamedLoanPaymentPerTurn(
    db,
    borrower,
    originatedTurn
  );
  const incomeCap = maxPrincipalFromIncome({
    incomePerTurn,
    ratePercent,
    termTurns,
    committedPaymentPerTurn,
  });
  const capInput = {
    bankCashReserves: cashReserves,
    lendableHeadroom: headroom,
    incomeCap,
  };
  const maxPrincipal = namedLoanPrincipalCap(capInput);
  if (principal > maxPrincipal) {
    return {
      ok: false,
      error: capExceededError(bindingNamedLoanCap(capInput), maxPrincipal),
    };
  }

  const loanId = new ObjectId();

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
    return {
      ok: true,
      loan: pendingLoan,
      pending: true,
      creditedTo: { kind: borrower.type, name: borrowerName },
    };
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

  return { ok: true, loan, creditedTo: { kind: borrower.type, name: borrowerName } };
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
      "bankCharter.type": {
        $in:
          loan.borrowerType === "corporation"
            ? ["retail", "investment", "universal"]
            : ["retail", "universal"],
      },
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
 * Open named loans where this character (or a corporation they lead) is the
 * borrower. The lending bank's console is the only other loan list, so without
 * this the borrower has no confirmation that proceeds landed.
 */
export async function listBorrowerFacingLoans(
  db: Db,
  params: {
    characterId: ObjectId;
    characterName: string;
    corporations: ReadonlyArray<{ id: ObjectId; name: string }>;
  }
): Promise<BorrowerFacingLoan[]> {
  const corpIds = params.corporations.map((c) => c.id);
  const borrowerClause: Array<Record<string, unknown>> = [
    { borrowerType: "character", borrowerId: params.characterId },
  ];
  if (corpIds.length > 0) {
    borrowerClause.push({ borrowerType: "corporation", borrowerId: { $in: corpIds } });
  }

  const loans = await db
    .collection<BankLoan>("bankLoans")
    .find({
      status: { $in: ["current", "arrears", "defaulted"] },
      $or: borrowerClause,
    })
    .sort({ originatedTurn: -1 })
    .limit(50)
    .toArray();

  if (loans.length === 0) return [];

  const bankIds = [...new Set(loans.map((loan) => loan.bankCorporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const banks = await db
    .collection<Pick<Corporation, "_id" | "name" | "sequentialId">>("corporations")
    .find({ _id: { $in: bankIds } })
    .project({ _id: 1, name: 1, sequentialId: 1 })
    .toArray();
  const bankById = new Map(banks.map((bank) => [bank._id.toString(), bank]));
  const corpNameById = new Map(params.corporations.map((corp) => [corp.id.toString(), corp.name]));

  return loans.map((loan) => {
    const bank = bankById.get(loan.bankCorporationId.toString());
    const isCharacter = loan.borrowerType === "character";
    return {
      id: loan._id.toString(),
      bankCorporationId: loan.bankCorporationId.toString(),
      bankName: bank?.name ?? "Private bank",
      bankSequentialId: bank?.sequentialId ?? null,
      currency: loan.currency,
      borrowerType: isCharacter ? "character" : "corporation",
      borrowerId: loan.borrowerId?.toString() ?? null,
      borrowerName: isCharacter
        ? params.characterName
        : (corpNameById.get(loan.borrowerId?.toString() ?? "") ?? "Corporation"),
      creditedTo: isCharacter ? "personalCash" : "corporationLiquidCapital",
      principal: loan.principal,
      outstanding: loan.outstanding,
      ratePercent: loan.ratePercent,
      originatedTurn: loan.originatedTurn,
      termTurns: loan.termTurns,
      status: loan.status,
    };
  });
}

/**
 * Pure NPC household loan-book math. Wired from bankingTurn.
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
 * $set / merge onto the loan doc (used by bankingTurn).
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
