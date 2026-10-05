/**
 * Interbank and central-bank facility interest for the banking turn. Split
 * out of bankingTurn.ts, which runs it every turn from processBankingTurn.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { InterbankLoan } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { MONEY_MOVE_COLLECTION, turnMoveKey } from "@/lib/banking/moneyMove";
import {
  facilityInterestTransition,
  facilityInterestAmounts,
} from "@/lib/banking/rules/facilityInterest";
import { serviceOneInterbankLoan } from "@/lib/banking/serviceInterbankLoan";
import {
  settleTransition,
  recoverProjections,
  unfinishedSettlementFilter,
} from "@/lib/banking/settlementJournal";
import type {
  BankingTransition,
  TransitionLeg,
  TransitionProjection,
} from "@/lib/banking/rules/boundary";
import { cbMarginRatePercent } from "@/lib/banking/interbank";
import { discountWindowRatePercent } from "@/lib/banking/discountWindow";
import { getCashReserves } from "@/lib/banking/bankCash";
import type { BankingTurnSummary } from "./bankingTurn";

/**
 * Service interbank interest from borrower to lender, and central-bank
 * facility interest from bank vaults to central-bank reserves.
 * Runs even when no deposit-taking banks need a pass this turn.
 */
export async function serviceInterbankAndCbMargin(
  db: Db,
  turn: number,
  summary: BankingTurnSummary,
  propTrading: boolean,
  centralBanks: ReadonlyMap<string, { primeRate?: number }>
): Promise<void> {
  if (propTrading) {
    // A loan may already carry this turn's stamp while its journal still owns
    // unfinished income projections. Never replay live cash legs here.
    const pending = await db
      .collection<{ _id: string; legs: { applied: boolean }[] }>(MONEY_MOVE_COLLECTION)
      .find(
        { ...unfinishedSettlementFilter(), kind: "interbank_interest", turn },
        { projection: { _id: 1, legs: 1 } }
      )
      .toArray();
    for (const receipt of pending) {
      if (!receipt.legs.every((leg) => leg.applied)) continue;
      const recovered = await recoverProjections(db, receipt._id);
      if (recovered.status === "partial" || recovered.status === "rejected" || recovered.error)
        throw new Error(recovered.error ?? "Interbank income recovery unfinished");
    }
  }
  const loans = propTrading
    ? await db
        .collection<InterbankLoan>("interbankLoans")
        .find({
          status: "current",
          lastProcessedTurn: { $ne: turn },
        })
        .toArray()
    : [];

  for (const loan of loans) {
    const result = await serviceOneInterbankLoan(db, turn, loan);
    summary.interbankInterestPaid += result.interestPaid;
    summary.interbankDefaultsWrittenOff += result.writtenOff;
  }

  const marginBanks = await db
    .collection<Corporation>("corporations")
    .find({
      "bankCharter.status": "active",
      // Either central-bank facility puts a bank in this pass. Selecting on the
      // margin line alone would leave a bank that drew ONLY on the discount
      // window (B8) unserviced forever — borrowing interest-free.
      $and: [
        {
          $or: [
            ...(propTrading ? [{ "bankCharter.cbMarginDebt": { $gt: 0 } }] : []),
            { "bankCharter.discountWindowDebt": { $gt: 0 } },
          ],
        },
        {
          $or: [
            { "bankCharter.lastCbMarginTurn": { $ne: turn } },
            { "bankCharter.lastCbMarginTurn": { $exists: false } },
            { "bankCharter.lastDiscountWindowTurn": { $ne: turn } },
            { "bankCharter.lastDiscountWindowTurn": { $exists: false } },
          ],
        },
      ],
    })
    .project({ _id: 1, liquidCapital: 1, bankCharter: 1 })
    .toArray();

  const receiptKeys = marginBanks.flatMap((corp) => [
    turnMoveKey("cb-margin-interest", corp._id.toString(), turn),
    turnMoveKey("discount-window-interest", corp._id.toString(), turn),
  ]);
  type Receipt = {
    _id: string;
    kind: string;
    turn: number;
    currency: string;
    legs: TransitionLeg[];
    projections?: { projection: TransitionProjection }[];
  };
  const receipts =
    receiptKeys.length > 0
      ? await db
          .collection<Receipt>(MONEY_MOVE_COLLECTION)
          .find(
            { _id: { $in: receiptKeys } },
            { projection: { kind: 1, turn: 1, currency: 1, legs: 1, projections: 1 } }
          )
          .toArray()
      : [];
  const receiptByKey = new Map(receipts.map((receipt) => [receipt._id, receipt]));

  for (const corp of marginBanks) {
    const charter = corp.bankCharter;
    if (!charter || charter.status !== "active") continue;
    const currency = charter.currency as CurrencyCode;
    const cbDocId = getBankId(getCountryIdForCurrency(currency));
    const storedPrime = centralBanks.get(cbDocId)?.primeRate;
    const prime = typeof storedPrime === "number" && Number.isFinite(storedPrime) ? storedPrime : 0;
    let availableCash = getCashReserves(charter);
    for (const facility of ["cbMargin", "discountWindow"] as const) {
      const enabled = facility === "discountWindow" || propTrading;
      const debt = Math.max(0, charter[`${facility}Debt`] ?? 0);
      const stamp =
        facility === "cbMargin" ? charter.lastCbMarginTurn : charter.lastDiscountWindowTurn;
      if (!enabled || debt <= 0 || stamp === turn) continue;
      const key = turnMoveKey(
        facility === "cbMargin" ? "cb-margin-interest" : "discount-window-interest",
        corp._id.toString(),
        turn
      );
      const prior = receiptByKey.get(key);
      // Old interrupted primitive-only receipts do not prove their original
      // charge. Leave them for explicit recovery instead of inventing arrears.
      if (prior && !prior.projections)
        throw new Error("Legacy facility receipt requires explicit recovery");
      const transition: BankingTransition = prior
        ? {
            key,
            kind: prior.kind,
            turn: prior.turn,
            currency: prior.currency,
            legs: prior.legs,
            projections: prior.projections!.map((row) => row.projection),
            event: { kind: "loan.paid", command: "bank.turn.facilityInterest" },
          }
        : facilityInterestTransition({
            key,
            bankId: corp._id.toString(),
            centralBankId: cbDocId,
            currency,
            turn,
            facility,
            debt,
            ratePercent:
              facility === "cbMargin"
                ? cbMarginRatePercent(prime)
                : discountWindowRatePercent(prime),
            availableCash,
          });
      const amounts = facilityInterestAmounts(transition);
      const result = await settleTransition(db, transition);
      if (result.status === "partial" || result.status === "rejected" || result.error)
        throw new Error(
          `Facility interest settlement unfinished: ${result.error ?? result.status}`
        );
      if (result.newlyAppliedProjections.includes(0))
        emitBankingAuditEvent(
          {
            ...transition.event,
            turn,
            currency,
            bankId: corp._id.toString(),
            settlementId: key,
            outcome: "ok",
            amount: amounts.paid,
          },
          db
        );
      // A replay's debit is already present in the balance loaded above.
      if (result.status === "applied") availableCash = Math.max(0, availableCash - amounts.paid);
      if (facility === "cbMargin") {
        summary.cbMarginInterestPaid += amounts.paid;
        summary.cbMarginInterestShortfall += amounts.shortfall;
      }
    }
  }
}
