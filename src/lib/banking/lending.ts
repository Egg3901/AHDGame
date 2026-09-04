import { ObjectId, type Db } from "mongodb";
import type { BankLoan } from "@/lib/db/types/bank";
import type { Character, Corporation } from "@/lib/db/types";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import type { IndexFund } from "@/lib/db/types/indexFund";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isBlockedBorrower, type ResolveFundConstituents } from "@/lib/banking/blacklist";
import {
  CHARACTER_LOAN_SPREAD_PP,
  CORP_INCOME_AVERAGING_TURNS,
  convertFaceBetweenCurrencies,
  namedLoanPaymentDue,
  remainingLoanTurns,
} from "@/lib/banking/lendingMath";
import {
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { estimatePerTurnCurrencyIncomeHomeFace } from "@/lib/lineOfCredit/currencyIncomeEstimate";
import { emitTx } from "@/lib/financialTxLog/emit";
import { isNamedLendingCharter } from "./charterKinds";
import { charterMay } from "@/lib/banking/rules/capabilities";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { loadBankingSnapshot } from "@/lib/banking/snapshot";
import { decideBankCommand } from "@/lib/banking/rules/decide";
import type { BorrowerSnapshot } from "@/lib/banking/rules/boundary";
import { reviveObjectIds, settleTransition } from "@/lib/banking/settlementJournal";

export { CHARACTER_LOAN_SPREAD_PP };

export {
  NPC_LOAN_BOOK_RATE_REFERENCE_PERCENT,
  NPC_LOAN_BOOK_RATE_SENSITIVITY,
  NPC_LOAN_BOOK_VOLUME_FACTOR_MIN,
  NPC_LOAN_BOOK_VOLUME_FACTOR_MAX,
  NPC_LOAN_BOOK_DEFAULT_BASE_PERCENT,
  NPC_LOAN_BOOK_DEFAULT_RATE_REFERENCE_PERCENT,
  NPC_LOAN_BOOK_DEFAULT_SENSITIVITY,
  NPC_LOAN_BOOK_DEFAULT_MIN_PERCENT,
  NPC_LOAN_BOOK_DEFAULT_MAX_PERCENT,
  computeNpcLoanBook,
  applyLoanPayment,
  markLoanDefaulted,
  namedLoanHeadroom,
  type NpcLoanBook,
} from "@/lib/banking/rules/loans";

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
 * The borrower as the rules see one: income in the loan currency, instalments
 * already committed, blacklist standing, currency match. Loaded once here so
 * the decision is a pure function of the snapshot and this record.
 */
async function loadBorrowerSnapshot(
  db: Db,
  charter: NonNullable<Corporation["bankCharter"]>,
  currency: CurrencyCode,
  borrower: LoanBorrower,
  currentTurn: number
): Promise<{ snapshot: BorrowerSnapshot; name: string } | { error: string }> {
  const resolveFunds = await buildFundConstituentResolver(db, charter.blacklist?.indexFundIds);
  if (borrower.type === "character") {
    const character = await db.collection<Character>("characters").findOne({ _id: borrower.id });
    if (!character) return { error: "Borrower character not found" };
    return {
      name: character.name ?? "Borrower",
      snapshot: {
        type: "character",
        id: borrower.id.toString(),
        incomePerTurn: await characterIncomeInLoanCurrency(db, character, currency),
        committedPaymentPerTurn: await committedNamedLoanPaymentPerTurn(db, borrower, currentTurn),
        blocked: isBlockedBorrower(charter, { characterId: borrower.id.toString() }, resolveFunds),
        currencyMatches: true,
      },
    };
  }
  const corp = await db.collection<Corporation>("corporations").findOne({ _id: borrower.id });
  if (!corp) return { error: "Borrower corporation not found" };
  return {
    name: corp.name ?? "Borrower",
    snapshot: {
      type: "corporation",
      id: borrower.id.toString(),
      incomePerTurn: await averageCorpIncomePerTurn(db, borrower.id, currentTurn),
      committedPaymentPerTurn: await committedNamedLoanPaymentPerTurn(db, borrower, currentTurn),
      blocked: isBlockedBorrower(charter, { corporationId: borrower.id.toString() }, resolveFunds),
      currencyMatches: resolveCorpLiquidCurrencyCode(corp) === currency,
    },
  };
}

/**
 * Originate a named loan. Objective auto-approval unless the bank has opted
 * into CEO approval, in which case the loan is parked as `pending` with no
 * money moved.
 *
 * The rules boundary decides (capability, term, self-lending, blacklist,
 * currency, the binding cap) and returns one transition: the loan record,
 * the bank's vault debit, the borrower's proceeds and the cached loan total.
 * The journal lands it exactly once. There is no compensating delete any
 * more: a crash leaves a visible half-applied record, never a booked loan
 * with no cash behind it.
 *
 * The vault IS debited. Origination used to credit the borrower and touch
 * nothing on the bank but a counter, so lending created money and repayment
 * later credited the bank with cash it had never paid out. The caps
 * (cash reserves, lendable headroom) always assumed the bank funds the loan;
 * now it does.
 */
export async function originateLoan(
  db: Db,
  bankCorporationId: ObjectId,
  borrower: LoanBorrower,
  principal: number,
  termTurns: number
): Promise<OriginateLoanResult> {
  const loaded = await loadBankingSnapshot(db, bankCorporationId);
  if (!loaded) return { ok: false, error: "Bank corporation not found" };
  const { snapshot, corporation: bankCorp } = loaded;
  const turn = snapshot.turn;

  const reject = (error: string): OriginateLoanResult => {
    emitBankingAuditEvent(
      {
        kind: "loan.originated",
        command: "bank.loan.originate",
        turn,
        outcome: "rejected",
        reason: error,
        currency: snapshot.currency,
        bankId: bankCorporationId.toString(),
        amount: principal,
        meta: { borrowerType: borrower.type, termTurns },
      },
      db
    );
    return { ok: false, error };
  };

  // The old order of checks, preserved for the messages a player sees.
  if (!snapshot.policy.privateBanking) return reject("Private banking is not enabled");
  if (!Number.isFinite(principal) || principal <= 0) {
    return reject("Principal must be a positive number");
  }
  if (
    !Number.isFinite(termTurns) ||
    termTurns < 4 ||
    termTurns > 120 ||
    !Number.isInteger(termTurns)
  ) {
    return reject("termTurns must be an integer from 4 to 120");
  }
  if (borrower.type === "corporation" && borrower.id.equals(bankCorporationId)) {
    return reject("A bank cannot lend to itself");
  }
  const charter = bankCorp.bankCharter;
  if (!isNamedLendingCharter(charter)) return reject("Corporation has no active bank charter");
  if (borrower.type === "character" && !charterMay(charter, "namedCharacterLending")) {
    return reject("An investment charter lends to corporations, not to individuals");
  }

  const currency = snapshot.currency as CurrencyCode;
  const loadedBorrower = await loadBorrowerSnapshot(db, charter, currency, borrower, turn);
  if ("error" in loadedBorrower) return reject(loadedBorrower.error);
  if (loadedBorrower.snapshot.blocked) return reject("Borrower is on the bank's blacklist");
  if (!loadedBorrower.snapshot.currencyMatches) {
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: borrower.id }, { projection: { liquidCurrencyCode: 1, countryId: 1 } });
    const corpCurrency = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
    return reject(
      `Loan currency ${currency} does not match corporation treasury currency ${corpCurrency ?? "unknown"}`
    );
  }

  const loanId = new ObjectId();
  const decision = decideBankCommand(
    snapshot,
    {
      type: "originate_named_loan",
      loanId: loanId.toHexString(),
      borrower: loadedBorrower.snapshot,
      principal,
      termTurns,
    },
    { commandId: loanId.toHexString() }
  );
  if (!decision.allowed) return reject(decision.message);

  const settled = await settleTransition(db, decision.transition);
  if (settled.status === "rejected" || settled.status === "partial" || settled.error) {
    return reject(
      settled.status === "partial" && settled.appliedLegs.length === 0
        ? "Failed to update bank loan book"
        : (settled.error ?? "Failed to write loan document")
    );
  }

  const loan = reviveObjectIds(decision.transition.projections[0].insert) as unknown as BankLoan;
  const pending = loan.status === "pending";

  if (!pending) {
    // The ledger row for the proceeds. The bank is the counterparty: this is
    // a transfer from its vault, which is what the guarded debit just did.
    await emitTx(db, {
      type: "bank_loan_origination",
      turn,
      createdAt: new Date(),
      ...(borrower.type === "character"
        ? {
            subjectType: "character" as const,
            subjectId: borrower.id,
            subjectName: loadedBorrower.name,
          }
        : {
            subjectType: "corporation" as const,
            subjectId: borrower.id,
            subjectName: loadedBorrower.name,
          }),
      amount: principal,
      currencyCode: currency,
      counterpartyType: "corporation",
      counterpartyId: bankCorporationId,
      counterpartyName: bankCorp.name,
      meta: {
        loanId: loanId.toString(),
        bankCorporationId: bankCorporationId.toString(),
        ratePercent: loan.ratePercent,
        termTurns: loan.termTurns,
        settlementId: decision.transition.key,
      },
    });
  }

  emitBankingAuditEvent(
    {
      ...decision.transition.event,
      turn,
      outcome: "ok",
      currency,
      bankId: bankCorporationId.toString(),
      settlementId: decision.transition.key,
    },
    db
  );

  return {
    ok: true,
    loan,
    ...(pending ? { pending: true } : {}),
    creditedTo: { kind: borrower.type, name: loadedBorrower.name },
  };
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
