/**
 * The one place a bank's balance sheet is defined.
 *
 * ## Why this module exists
 *
 * Private banking accumulated roughly fifteen patches that all chased the same
 * disease: a quantity on the bank's books that no cash stood behind, and two
 * screens that answered the same question with two different numbers. Ticket
 * 1111 is the canonical case. The console computed equity from cash-backed
 * deposits, the solvency pass computed reserve cover from the whole deposit
 * aggregate (which includes player pointer balances the bank never held), and
 * both were "right" against their own local arithmetic.
 *
 * A bug of that shape cannot be fixed by fixing the two call sites, because a
 * third one gets written next month. It is fixed by there being exactly one
 * definition of each line, in one file, that every phase, pass, route and panel
 * reads. That is this file. Nothing else in the codebase may define
 * `bankEquity`, `requiredReserves`, the deposit ceiling, the run line or the
 * confidence denominators; the modules that used to are now thin re-exports.
 *
 * ## The two deposit kinds are not interchangeable, ever
 *
 * - **NPC household deposits (`npcDeposits`) are CASH-BACKED.** `bankingTurn`
 *   debits the central bank's `externalBroadMoney` and credits the bank's
 *   `cashReserves` by the same amount. Real money moved, so it is a real
 *   liability, it sits in every reserve and equity denominator, and returning
 *   it to the depositor must move cash back.
 * - **Player savings (`savingsHolder`) are a POINTER.** The balance never
 *   leaves `character.currencyBalances.savings`; only the label saying who
 *   holds it changes. No cash arrived, so it is NOT a liability of the bank,
 *   NOT in the reserve denominator, NOT in equity, and returning it moves no
 *   money at all.
 *
 * The one thing pointer deposits do bind is the deposit ceiling: a bank may not
 * label more savings as its own than its branch network and capital can carry.
 * That is a capacity rule, not a cash rule, which is why it is the only line
 * below that takes them as an input.
 *
 * ## Two capital lines, deliberately, with different jobs
 *
 * `bookEquity` answers "how much of this bank is the owner's?" and is the
 * ceiling on every distribution. `regulatoryCapital` answers "how much loss can
 * this bank absorb before someone else eats it?" and is the supervisor's
 * anchor. They differ because the supervisor deliberately excludes the deposit
 * base and the loan book from its ratio (see `capitalAdequacy.ts` for why), and
 * the owner deliberately cannot count depositor money as their own. Both are
 * computed here, from the same inputs, so the difference is a stated design
 * choice rather than two files that drifted.
 */

import type { BankCharter } from "@/lib/db/types/bank";

/** Supervisory standing. Defined here so the distribution gate has no cycle. */
export type CapitalStanding =
  /** Meets the minimum and survives the stress scenario. */
  | "adequate"
  /** Meets the minimum but fails the scenario: distributions barred. */
  | "stressed"
  /** Below the minimum: recapitalize or lose the charter. */
  | "undercapitalized";

/**
 * May this bank distribute to its owner (upstream, dividends, prop risk)?
 *
 * Only an ADEQUATE bank may. A bank that cannot survive the published scenario
 * does not get to pay its owner in the meantime, and one below the minimum
 * obviously does not.
 */
export function mayDistribute(standing: CapitalStanding): boolean {
  return standing === "adequate";
}

/** Everything the bank owes somebody other than its shareholders. */
export interface BankBorrowings {
  discountWindowDebt?: number;
  discountWindowArrears?: number;
  cbMarginDebt?: number;
  cbMarginArrears?: number;
  interbankDebt?: number;
}

type BorrowingCharter = Pick<
  BankCharter,
  | "discountWindowDebt"
  | "discountWindowArrears"
  | "cbMarginDebt"
  | "cbMarginArrears"
  | "interbankDebt"
>;

/**
 * Charter fields every balance-sheet line reads. Kept as one type so a new
 * liability field is added in one place and every line picks it up.
 */
export type BalanceSheetCharter = BorrowingCharter &
  Pick<BankCharter, "npcDeposits" | "cashReserves" | "totalLoans" | "propBookMarkValue">;

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nonNegative(value: number | null | undefined): number {
  return Math.max(0, finite(value));
}

/** Sum of a charter's borrowings. Keeps call sites from forgetting a field. */
export function borrowingsFromCharter(
  charter: BorrowingCharter | null | undefined
): BankBorrowings {
  return {
    discountWindowDebt: charter?.discountWindowDebt,
    discountWindowArrears: charter?.discountWindowArrears,
    cbMarginDebt: charter?.cbMarginDebt,
    cbMarginArrears: charter?.cbMarginArrears,
    interbankDebt: charter?.interbankDebt,
  };
}

export function totalBorrowings(borrowings: BankBorrowings): number {
  return (
    nonNegative(borrowings.discountWindowDebt) +
    nonNegative(borrowings.discountWindowArrears) +
    nonNegative(borrowings.cbMarginDebt) +
    nonNegative(borrowings.cbMarginArrears) +
    nonNegative(borrowings.interbankDebt)
  );
}

/** Cash the bank holds. Absent on charters written before the ring-fence. */
export function getCashReserves(
  charter: Pick<BankCharter, "cashReserves"> | null | undefined
): number {
  return finite(charter?.cashReserves);
}

/**
 * Deposits that actually credited `cashReserves`. See the module note: player
 * pointer balances are excluded because no cash ever arrived for them.
 */
export function cashBackedDeposits(
  charter: Pick<BankCharter, "npcDeposits"> | null | undefined
): number {
  return nonNegative(charter?.npcDeposits);
}

/**
 * Player pointer deposits: the cached total book less the cash-backed part.
 *
 * Derived rather than stored because `totalDeposits` is the aggregate
 * `bankingTurn` recomputes, and a stored second copy is one more thing that can
 * disagree with it.
 */
export function pointerDeposits(
  charter: Pick<BankCharter, "npcDeposits" | "totalDeposits"> | null | undefined
): number {
  return Math.max(0, nonNegative(charter?.totalDeposits) - cashBackedDeposits(charter));
}

/** Reserves the bank must retain: `cashBackedDeposits x reserveRatio`. */
export function requiredReserves(
  charter: Pick<BankCharter, "npcDeposits"> | null | undefined,
  reserveRatio: number
): number {
  return cashBackedDeposits(charter) * nonNegative(reserveRatio);
}

/**
 * Book equity: the shareholders' claim once every non-shareholder is paid.
 *
 *   equity = cash + loans - cashBackedDeposits - borrowings
 *
 * The prop book is deliberately absent from the asset side. It is marked to a
 * moving market and force-liquidated under stress, so counting it would let an
 * owner upstream cash against a valuation that the same turn's liquidation can
 * erase. Arrears ARE in the borrowings side: unpaid interest is still owed, and
 * leaving it out was equity overstated by exactly the amount the bank could not
 * afford to pay.
 */
export function bankEquity(charter: BalanceSheetCharter | null | undefined): number {
  const assets = getCashReserves(charter) + nonNegative(charter?.totalLoans);
  const liabilities = cashBackedDeposits(charter) + totalBorrowings(borrowingsFromCharter(charter));
  return assets - liabilities;
}

/**
 * Supervisory capital: own cash less every borrowed claim on it.
 *
 * Excludes deposits and loans on purpose; `capitalAdequacy.ts` documents why at
 * length. The property that matters is that a draw on the discount window moves
 * cash and liability together and leaves this line unchanged, so a bank cannot
 * borrow its way out of a capital breach.
 */
export function regulatoryCapital(charter: BalanceSheetCharter | null | undefined): number {
  return nonNegative(charter?.cashReserves) - totalBorrowings(borrowingsFromCharter(charter));
}

/**
 * Leverage cap on the NPC deposit base: at most this multiple of book equity.
 *
 * Capacity alone used to size the ceiling, so a bank with a large financial
 * sector but no capital could anchor billions it did not stand behind. 12x sits
 * above the live solvent banks and drives a negative-equity bank's ceiling to
 * zero, so the normal per-turn outflow unwinds it.
 */
export const NPC_DEPOSIT_MAX_EQUITY_LEVERAGE = 12;

/** Cash below this share of required reserves fails a red-banded bank. */
export const RUN_FAILURE_COVER_FRACTION = 0.5;

export interface BankBalanceSheetInput {
  charter: BalanceSheetCharter & Pick<BankCharter, "totalDeposits" | "capitalStanding">;
  /** Reserve requirement for the charter currency, 0..1. */
  reserveRatio: number;
  /**
   * Ceiling implied by branch capacity, from `capacityAllocation.ts`. Omit when
   * the caller has not loaded the corp's sectors; the equity cap still applies.
   */
  capacityCeiling?: number;
}

/**
 * Every balance-sheet line, computed once, for every consumer.
 *
 * Turn phases, the solvency pass, the console API and the UI all read this.
 * If a number a player can see is not on this object, it should be.
 */
export interface BankBalanceSheet {
  cashReserves: number;
  /** NPC household deposits: real cash, real liability. */
  cashBackedDeposits: number;
  /** Player savings pointed at this bank: no cash, no liability. */
  pointerDeposits: number;
  totalLoans: number;
  propBookMarkValue: number;
  borrowings: BankBorrowings;
  totalBorrowings: number;
  /** Owner's claim. Ceiling on every distribution. */
  bookEquity: number;
  /** Supervisor's loss-absorbing anchor. */
  regulatoryCapital: number;
  requiredReserves: number;
  /** Cash above the requirement. Not the same as distributable. */
  reserveSurplus: number;
  /** What the owner may actually take out right now. */
  distributable: number;
  /** Ceiling from branch capacity, before the equity cap. */
  capacityCeiling: number;
  /** Ceiling from equity: `max(0, equity) x 12`. */
  equityCeiling: number;
  /** The binding deposit ceiling: the lower of the two. */
  depositCeiling: number;
  /** Which of the two ceilings binds right now. */
  depositCeilingBinds: "capacity" | "equity";
  /** Cash below this fails the bank once its published band is red. */
  runLine: number;
  /** cash / required, uncapped. 1 means exactly meeting the requirement. */
  reserveCoverRatio: number;
  /** Distance to the run line. Negative means already under it. */
  headroomToRunLine: number;
}

export function bankBalanceSheet(input: BankBalanceSheetInput): BankBalanceSheet {
  const charter = input.charter;
  const cash = getCashReserves(charter);
  const npc = cashBackedDeposits(charter);
  const loans = nonNegative(charter?.totalLoans);
  const borrowings = borrowingsFromCharter(charter);
  const borrowed = totalBorrowings(borrowings);
  const equity = bankEquity(charter);
  const required = requiredReserves(charter, input.reserveRatio);
  const reserveSurplus = cash - required;

  const capacityCeiling = nonNegative(input.capacityCeiling);
  const equityCeiling = Math.max(0, equity) * NPC_DEPOSIT_MAX_EQUITY_LEVERAGE;
  const depositCeiling =
    input.capacityCeiling === undefined ? equityCeiling : Math.min(capacityCeiling, equityCeiling);

  // Two ceilings on a distribution, take the lower: the bank may not drop below
  // its reserve requirement, and it may never pay the owner more than its book
  // equity, because anything above equity is depositor money. Zero unless the
  // supervisor calls the bank adequate.
  const standing = charter?.capitalStanding;
  const distributable =
    standing && !mayDistribute(standing) ? 0 : Math.max(0, Math.min(reserveSurplus, equity));

  const runLine = RUN_FAILURE_COVER_FRACTION * required;

  return {
    cashReserves: cash,
    cashBackedDeposits: npc,
    pointerDeposits: pointerDeposits(charter),
    totalLoans: loans,
    propBookMarkValue: nonNegative(charter?.propBookMarkValue),
    borrowings,
    totalBorrowings: borrowed,
    bookEquity: equity,
    regulatoryCapital: regulatoryCapital(charter),
    requiredReserves: required,
    reserveSurplus,
    distributable,
    capacityCeiling,
    equityCeiling,
    depositCeiling,
    depositCeilingBinds: equityCeiling <= capacityCeiling ? "equity" : "capacity",
    runLine,
    reserveCoverRatio: required > 0 ? cash / required : 1,
    headroomToRunLine: cash - runLine,
  };
}

/**
 * Lower the capacity-derived ceiling to what the bank's equity can stand behind.
 *
 * Kept as a named export because the deposit-acceptance path has a capacity
 * ceiling and an equity figure in hand but no full charter.
 */
export function equityCappedDepositCeiling(capacityCeiling: number, equity: number): number {
  return Math.min(
    nonNegative(capacityCeiling),
    Math.max(0, finite(equity)) * NPC_DEPOSIT_MAX_EQUITY_LEVERAGE
  );
}

/**
 * One cap, stated the way a player needs to read it.
 *
 * Tickets 1090, 1111 and 1113 are all the same complaint: the console showed a
 * number that stopped the player doing something and never said where the
 * number came from, so the only way to learn a cap was to hit it. Every cap
 * that can block an action ships its formula and the values currently in that
 * formula, from the same computation that enforces it.
 */
export interface BankCapExplainer {
  key: "depositCeiling" | "requiredReserves" | "distributable" | "runLine" | "bookEquity";
  label: string;
  /** The rule, in symbols. */
  formula: string;
  /** The rule, with this bank's numbers in it. */
  inputs: { label: string; value: number }[];
  value: number;
  /** One line naming what moves it. */
  lever: string;
}

export function explainBankCaps(sheet: BankBalanceSheet): BankCapExplainer[] {
  return [
    {
      key: "bookEquity",
      label: "Book equity",
      formula: "cash + loans out - household deposits - borrowings",
      inputs: [
        { label: "Cash", value: sheet.cashReserves },
        { label: "Loans out", value: sheet.totalLoans },
        { label: "Household deposits", value: sheet.cashBackedDeposits },
        { label: "Borrowings", value: sheet.totalBorrowings },
      ],
      value: sheet.bookEquity,
      lever: "Post capital, or earn it: retained interest counts the same as posted capital.",
    },
    {
      key: "requiredReserves",
      label: "Required reserves",
      formula: "household deposits x reserve ratio",
      inputs: [
        { label: "Household deposits", value: sheet.cashBackedDeposits },
        {
          label: "Reserve ratio",
          value:
            sheet.cashBackedDeposits > 0 ? sheet.requiredReserves / sheet.cashBackedDeposits : 0,
        },
      ],
      value: sheet.requiredReserves,
      lever:
        "Player savings pointed at the bank are not in this line; only household deposits are.",
    },
    {
      key: "depositCeiling",
      label: "Deposit ceiling",
      formula: "min(branch capacity ceiling, book equity x 12)",
      inputs: [
        { label: "Branch capacity ceiling", value: sheet.capacityCeiling },
        { label: "Book equity x 12", value: sheet.equityCeiling },
      ],
      value: sheet.depositCeiling,
      lever:
        sheet.depositCeilingBinds === "equity"
          ? "Equity binds: post capital to raise the ceiling. Branches alone will not move it."
          : "Capacity binds: build financial capacity or raise the branch share.",
    },
    {
      key: "distributable",
      label: "Withdrawable to the parent",
      formula: "min(cash - required reserves, book equity), and 0 unless capital is adequate",
      inputs: [
        { label: "Cash above requirement", value: sheet.reserveSurplus },
        { label: "Book equity", value: sheet.bookEquity },
      ],
      value: sheet.distributable,
      lever:
        "Reserves above the requirement are still mostly depositor money; equity is the real ceiling.",
    },
    {
      key: "runLine",
      label: "Run line",
      formula: "0.5 x required reserves (fails the bank while the band is red)",
      inputs: [
        { label: "Required reserves", value: sheet.requiredReserves },
        { label: "Cash now", value: sheet.cashReserves },
      ],
      value: sheet.runLine,
      lever: "Hold more cash, or lend less, or shed deposits to lower the requirement.",
    },
  ];
}
