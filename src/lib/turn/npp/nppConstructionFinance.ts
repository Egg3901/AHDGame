import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { isBlockedBorrower } from "@/lib/banking/blacklist";
import { isNamedLendingCharter } from "@/lib/banking/charterKinds";
import { charterSnapshotFrom } from "@/lib/banking/snapshot";
import type {
  ConstructionFundingBankCorporation,
  PreloadedConstructionFundingContext,
} from "@/lib/banking/constructionFundingContext";
import type { BankingSnapshot, BorrowerSnapshot } from "@/lib/banking/rules/boundary";
import { defaultReserveRequirement } from "@/lib/banking/rules/reserves";
import type { BankingPolicySnapshot } from "@/lib/banking/rules/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import type { BankLoan } from "@/lib/db/types/bank";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Corporation, CorporationHistory } from "@/lib/db/types";
import type { CorporateSector, SectorBuildOrder } from "@/lib/db/types/corporation";
import {
  CORP_INCOME_AVERAGING_TURNS,
  convertFaceBetweenCurrencies,
  namedLoanPaymentDue,
  remainingLoanTurns,
} from "@/lib/banking/lendingMath";
import { quoteConstructionFinance } from "@/lib/banking/rules/constructionFinance";
import { CAPACITY_BUILD_CANCEL_REFUND } from "@/lib/constants/capacityEconomy";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";

export const NPP_CONSTRUCTION_FINANCE_CANDIDATE_LIMIT = 64;
export const NPP_CONSTRUCTION_FINANCE_TERM_TURNS = 48;

export interface NppConstructionFinanceIntent {
  sector: CorporateSector;
  order: SectorBuildOrder;
  costLocal: number;
  cashContributionLimitLocal: number;
  priority: number;
  fill: number;
}

export interface NppConstructionFinanceCandidate extends NppConstructionFinanceIntent {
  corporation: Corporation;
  currency: CurrencyCode;
}

export interface NppConstructionFinanceRequest extends NppConstructionFinanceCandidate {
  bankId: ObjectId;
  principal: number;
  termTurns: number;
  preloadedFundingContext: PreloadedConstructionFundingContext;
}

export interface NppConstructionLender {
  bank: ConstructionFundingBankCorporation;
  snapshot: BankingSnapshot;
  fundConstituents: ReadonlyMap<string, readonly string[]>;
}

export interface NppConstructionFundingPool {
  turn: number;
  policy: BankingPolicySnapshot;
  lendersByCurrency: ReadonlyMap<CurrencyCode, readonly NppConstructionLender[]>;
  borrowersByCorpAndCurrency: ReadonlyMap<string, BorrowerSnapshot>;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
}

function borrowerCurrencyKey(corporationId: string, currency: CurrencyCode): string {
  return `${corporationId}:${currency}`;
}

/** Load lender and borrower quote facts in bounded cohort reads for the NPP turn. */
export async function loadNppConstructionFundingPool(input: {
  db: Db;
  turn: number;
  corporations: readonly Corporation[];
  policy: BankingPolicySnapshot;
  eraUnitScale: number;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
}): Promise<NppConstructionFundingPool | null> {
  const { db, turn, corporations, policy, eraUnitScale, fxByCurrency } = input;
  if (
    !policy.privateBanking ||
    !policy.treasuryCashLedger ||
    !policy.constructionFinance ||
    corporations.length === 0
  )
    return null;

  const currencyByCorpId = new Map<string, CurrencyCode>();
  for (const corporation of corporations) {
    const currency = resolveCorpLiquidCurrencyCode(corporation);
    if (currency) currencyByCorpId.set(corporation._id.toHexString(), currency);
  }
  const currencies = [...new Set(currencyByCorpId.values())];
  if (currencies.length === 0) return null;
  const borrowerIds = corporations.map((corporation) => corporation._id);
  const historyStart = Math.max(1, turn - CORP_INCOME_AVERAGING_TURNS + 1);

  const [bankCorporations, histories, loans] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        {
          "bankCharter.status": "active",
          "bankCharter.currency": { $in: currencies },
        },
        {
          projection: {
            _id: 1,
            bankCharter: 1,
            liquidCapital: 1,
            bankConstructionFunding: 1,
            bankCharterTransfer: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<Pick<CorporationHistory, "corporationId" | "turn" | "income">>(
        "corporationHistory"
      )
      .find({ corporationId: { $in: borrowerIds }, turn: { $gte: historyStart, $lte: turn } })
      .project({ corporationId: 1, turn: 1, income: 1 })
      .toArray(),
    db
      .collection<BankLoan>("bankLoans")
      .find({
        borrowerType: "corporation",
        borrowerId: { $in: borrowerIds },
        status: { $in: ["current", "arrears"] },
      })
      .project({
        borrowerId: 1,
        currency: 1,
        outstanding: 1,
        ratePercent: 1,
        originatedTurn: 1,
        termTurns: 1,
      })
      .toArray(),
  ]);
  if (bankCorporations.length === 0) return null;

  const fundIds = [
    ...new Set(bankCorporations.flatMap((bank) => bank.bankCharter?.blacklist?.indexFundIds ?? [])),
  ];
  const [funds, centralBanks] = await Promise.all([
    fundIds.length > 0
      ? db
          .collection<{ slug: string; targetConstituents?: Array<{ corporationId: ObjectId }> }>(
            "indexFunds"
          )
          .find({ slug: { $in: fundIds } })
          .project({ slug: 1, targetConstituents: 1 })
          .toArray()
      : Promise.resolve([]),
    db
      .collection<CentralBank>("centralBanks")
      .find({
        _id: { $in: currencies.map((currency) => getBankId(getCountryIdForCurrency(currency))) },
      })
      .project({ _id: 1, primeRate: 1, bankReserveRequirement: 1 })
      .toArray(),
  ]);
  const fundConstituents = new Map(
    funds.map((fund) => [
      fund.slug,
      (fund.targetConstituents ?? []).map((constituent) => constituent.corporationId.toHexString()),
    ])
  );
  const centralBankById = new Map(centralBanks.map((bank) => [String(bank._id), bank]));
  const centralBankIds = new Map(
    currencies.map((currency) => [currency, getBankId(getCountryIdForCurrency(currency))])
  );
  const defaultReserveRatio = defaultReserveRequirement(eraUnitScale);
  const historiesByCorp = new Map<string, number[]>();
  for (const history of histories) {
    const id = history.corporationId.toHexString();
    if (typeof history.income !== "number" || !Number.isFinite(history.income)) continue;
    let rows = historiesByCorp.get(id);
    if (!rows) historiesByCorp.set(id, (rows = []));
    rows.push(history.income);
  }
  const loansByCorp = new Map<string, BankLoan[]>();
  for (const loan of loans) {
    if (!loan.borrowerId) continue;
    const id = loan.borrowerId.toHexString();
    let rows = loansByCorp.get(id);
    if (!rows) loansByCorp.set(id, (rows = []));
    rows.push(loan);
  }

  const borrowersByCorpAndCurrency = new Map<string, BorrowerSnapshot>();
  for (const corporation of corporations) {
    const corporationId = corporation._id.toHexString();
    const currency = currencyByCorpId.get(corporationId);
    if (!currency) continue;
    const incomeRows = historiesByCorp.get(corporationId) ?? [];
    const incomePerTurn = incomeRows.length
      ? Math.max(0, incomeRows.reduce((sum, income) => sum + income, 0) / incomeRows.length)
      : 0;
    const committedPaymentPerTurn = (loansByCorp.get(corporationId) ?? []).reduce((sum, loan) => {
      const native = namedLoanPaymentDue(
        loan.outstanding,
        loan.ratePercent,
        remainingLoanTurns(loan.originatedTurn, loan.termTurns, turn)
      );
      return (
        sum +
        convertFaceBetweenCurrencies(
          native,
          loan.currency,
          currency,
          fxByCurrency.get(loan.currency) ?? 0,
          fxByCurrency.get(currency) ?? 0
        )
      );
    }, 0);
    borrowersByCorpAndCurrency.set(borrowerCurrencyKey(corporationId, currency), {
      type: "corporation",
      id: corporationId,
      incomePerTurn,
      committedPaymentPerTurn,
      blocked: false,
      currencyMatches: true,
    });
  }

  const lendersByCurrency = new Map<CurrencyCode, NppConstructionLender[]>();
  for (const bank of bankCorporations) {
    const charter = bank.bankCharter;
    if (
      !charter ||
      !isNamedLendingCharter(charter) ||
      charter.status !== "active" ||
      bank.bankConstructionFunding ||
      bank.bankCharterTransfer
    )
      continue;
    const currency = charter.currency;
    const centralBankId = centralBankIds.get(currency);
    const centralBank = centralBankId ? centralBankById.get(centralBankId) : undefined;
    const primeRate = centralBank?.primeRate;
    const snapshot: BankingSnapshot = {
      turn,
      policy,
      bankId: bank._id.toHexString(),
      currency,
      charter: charterSnapshotFrom(charter),
      corporationLiquidCapital: Math.max(0, bank.liquidCapital ?? 0),
      reserveRatio:
        typeof centralBank?.bankReserveRequirement === "number" &&
        Number.isFinite(centralBank.bankReserveRequirement)
          ? centralBank.bankReserveRequirement
          : defaultReserveRatio,
      playerDepositsAreLiabilities: savingsReadsAuthoritative(policy, currency),
      primeRate: typeof primeRate === "number" && Number.isFinite(primeRate) ? primeRate : 0,
      centralBankId: centralBankId ?? "",
    };
    const entry: NppConstructionLender = {
      bank: { _id: bank._id, bankCharter: charter },
      snapshot,
      fundConstituents,
    };
    let rows = lendersByCurrency.get(currency);
    if (!rows) lendersByCurrency.set(currency, (rows = []));
    rows.push(entry);
  }
  for (const rows of lendersByCurrency.values()) {
    rows.sort((a, b) => a.bank._id.toHexString().localeCompare(b.bank._id.toHexString()));
  }

  return { turn, policy, lendersByCurrency, borrowersByCorpAndCurrency, fxByCurrency };
}

/** Pick the lowest-rate eligible same-currency lender, with id as stable tie break. */
export function selectNppConstructionFundingContext(
  pool: NppConstructionFundingPool,
  candidate: NppConstructionFinanceCandidate
): { bankId: ObjectId; principal: number; context: PreloadedConstructionFundingContext } | null {
  const borrowerId = candidate.corporation._id.toHexString();
  const baseBorrower = pool.borrowersByCorpAndCurrency.get(
    borrowerCurrencyKey(borrowerId, candidate.currency)
  );
  if (!baseBorrower) return null;
  const principal = candidate.costLocal * CAPACITY_BUILD_CANCEL_REFUND;
  const options = pool.lendersByCurrency.get(candidate.currency) ?? [];
  const eligible: Array<{
    lender: NppConstructionLender;
    borrower: BorrowerSnapshot;
    ratePercent: number;
  }> = [];
  for (const lender of options) {
    if (lender.bank._id.equals(candidate.corporation._id)) continue;
    const charter = lender.bank.bankCharter;
    if (!charter || lender.snapshot.currency !== candidate.currency) continue;
    const blocked = isBlockedBorrower(
      charter,
      { corporationId: borrowerId },
      (fundId) => lender.fundConstituents.get(fundId) ?? []
    );
    const borrower: BorrowerSnapshot = { ...baseBorrower, blocked };
    const quote = quoteConstructionFinance({
      enabled: true,
      bank: lender.snapshot,
      borrower,
      loanId: "000000000000000000000001",
      claimId: "npp-quote",
      sectorId: candidate.sector._id.toHexString(),
      principal,
      termTurns: NPP_CONSTRUCTION_FINANCE_TERM_TURNS,
      constructionCostLocal: candidate.costLocal,
      collateralCostLocal: candidate.costLocal,
      borrowerCashLocal: candidate.cashContributionLimitLocal,
    });
    if (!quote.allowed || quote.borrowerContribution > candidate.cashContributionLimitLocal)
      continue;
    eligible.push({ lender, borrower, ratePercent: quote.ratePercent });
  }
  eligible.sort(
    (a, b) =>
      a.ratePercent - b.ratePercent ||
      a.lender.bank._id.toHexString().localeCompare(b.lender.bank._id.toHexString())
  );
  const selected = eligible[0];
  if (!selected) return null;
  const context: PreloadedConstructionFundingContext = {
    bankSnapshot: selected.lender.snapshot,
    bankCorporation: selected.lender.bank,
    borrowerSnapshot: selected.borrower,
    turn: pool.turn,
    policy: pool.policy,
  };
  return { bankId: selected.lender.bank._id, principal, context };
}

/** Keep candidate ordering stable; overflow is measured as backlog, not a global build ban. */
export function boundNppConstructionFinanceCandidates(
  candidates: readonly NppConstructionFinanceCandidate[],
  limit = NPP_CONSTRUCTION_FINANCE_CANDIDATE_LIMIT
): { selected: NppConstructionFinanceCandidate[]; backlogCount: number } {
  const ordered = [...candidates].sort(
    (a, b) =>
      b.priority - a.priority ||
      b.fill - a.fill ||
      b.order.unitsOrdered - a.order.unitsOrdered ||
      a.corporation._id.toHexString().localeCompare(b.corporation._id.toHexString()) ||
      a.sector._id.toHexString().localeCompare(b.sector._id.toHexString())
  );
  const safeLimit = Number.isSafeInteger(limit) && limit >= 0 ? limit : 0;
  return {
    selected: ordered.slice(0, safeLimit),
    backlogCount: Math.max(0, ordered.length - safeLimit),
  };
}
