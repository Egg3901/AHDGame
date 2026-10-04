import type { Db, ObjectId } from "mongodb";
import type { Corporation, FederalBudget } from "@/lib/db/types";
import {
  settleTransition,
  resumeSettlement,
  unfinishedSettlementFilter,
} from "@/lib/banking/settlementJournal";
import { oid } from "@/lib/banking/rules/boundary";
import type { BankingPolicySnapshot } from "@/lib/banking/rules/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import { guaranteedDepositorShortfall } from "@/lib/livingConflict/rules/financialRescue";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";

interface FundedGuarantee {
  _id: string;
  crisisActionId?: string;
  countryId: string;
  currency: string;
  bankIds: ObjectId[];
  /** Missing epochs identify an older promise that cannot safely pay a new charter. */
  bankEpochs?: { bankId: ObjectId; charteredTurn: number; currency: string }[];
  treasuryId?: FederalBudget["_id"];
  treasuryCurrencyCodePresent?: boolean;
  treasuryCurrencyCode?: string | null;
  treasuryCashLedgerEnabled?: boolean;
  escrowBalance: number;
  expiresTurn: number;
  status: "pending" | "active" | "expired";
}

interface GuaranteeFundingMove {
  _id: string;
  kind: string;
  currency: string;
  status: string;
  legs: {
    kind: string;
    amount: number;
    collection?: string;
    path?: string;
    filter?: Record<string, unknown>;
    applied?: boolean;
  }[];
}

interface GuaranteeRefundSource {
  treasuryId: FederalBudget["_id"];
  cashLedger: boolean;
  currencyCodePresent?: boolean;
  currencyCode?: string | null;
}

/**
 * Fund the normal failed-bank estate before its existing priority waterfall.
 * Coverage never changes creditor seniority. Legacy unfunded promises cannot
 * pay claims. Every payout and expiry release spends the same guarded escrow.
 */
export async function processFinancialCrisisGuarantees(
  db: Db,
  turn: number,
  policy: BankingPolicySnapshot
): Promise<{ paid: number; refunded: number }> {
  const summary = { paid: 0, refunded: 0 };
  // Only earlier-turn attempts are recoverable here; live requests may still
  // own a current-turn claim. Recovery precedes reading the escrow snapshot.
  const pending = await db
    .collection<{ _id: string }>("bankMoneyMoves")
    .find({
      ...unfinishedSettlementFilter(),
      turn: { $lt: turn },
      kind: {
        $in: [
          "financial_crisis_recapitalize",
          "financial_crisis_stimulus",
          "financial_crisis_sovereign_support",
          "financial_crisis_austerity",
          "financial_crisis_guarantee",
          "financial_crisis_resolve",
          "financial_crisis_guarantee_claim",
          "financial_crisis_guarantee_refund",
        ],
      },
    })
    .toArray();
  for (const row of pending) {
    const result = await resumeSettlement(db, row._id);
    if (result.error || result.status !== "applied")
      throw new Error(result.error ?? "Financial intervention recovery is incomplete");
  }

  const guarantees = await db
    .collection<FundedGuarantee>("bankGuarantees")
    .find({
      status: "active",
      escrowBalance: { $gt: 0 },
    })
    .sort({ openedTurn: 1, _id: 1 })
    .toArray();
  // Resolve expiry provenance in bounded batches before debiting escrow.
  // Legacy rows recover their original spend path from the funded journal.
  const expired = guarantees.filter((guarantee) => turn > guarantee.expiresTurn);
  const legacyExpired = expired.filter((guarantee) => !hasFrozenRefundSource(guarantee));
  const legacyFundingMoves = legacyExpired.length
    ? await db
        .collection<GuaranteeFundingMove>("bankMoneyMoves")
        .find(
          {
            _id: {
              $in: legacyExpired.map((guarantee) => guarantee.crisisActionId ?? guarantee._id),
            },
          },
          { projection: { _id: 1, kind: 1, currency: 1, status: 1, legs: 1 } }
        )
        .toArray()
    : [];
  const moveById = new Map(legacyFundingMoves.map((move) => [move._id, move]));
  const refundSourceById = new Map<string, GuaranteeRefundSource>();
  for (const guarantee of expired) {
    const source = hasFrozenRefundSource(guarantee)
      ? {
          treasuryId: guarantee.treasuryId!,
          cashLedger: guarantee.treasuryCashLedgerEnabled!,
          currencyCodePresent: guarantee.treasuryCurrencyCodePresent,
          currencyCode: guarantee.treasuryCurrencyCode,
        }
      : legacyRefundSource(guarantee, moveById.get(guarantee.crisisActionId ?? guarantee._id));
    if (source) refundSourceById.set(guarantee._id, source);
  }
  const refundTreasuryIds = [
    ...new Set([...refundSourceById.values()].map((source) => source.treasuryId)),
  ];
  const refundBudgets = refundTreasuryIds.length
    ? await db
        .collection<FederalBudget>("federalBudget")
        .find(
          { _id: { $in: refundTreasuryIds } },
          { projection: { _id: 1, countryId: 1, currencyCode: 1 } }
        )
        .toArray()
    : [];
  const refundBudgetById = new Map(refundBudgets.map((budget) => [String(budget._id), budget]));
  for (const guarantee of guarantees) {
    let available = guarantee.escrowBalance;
    // Epochless legacy promises cannot pay a later charter, but any remaining
    // funded escrow can still be returned after its original expiry.
    const banks = guarantee.bankEpochs?.length
      ? await db
          .collection<Corporation>("corporations")
          .find({
            $or: guarantee.bankEpochs.map((epoch) => ({
              _id: epoch.bankId,
              countryId: guarantee.countryId as Corporation["countryId"],
              "bankCharter.charteredTurn": epoch.charteredTurn,
              "bankCharter.status": "failed",
              "bankCharter.currency": epoch.currency,
              "bankCharter.failedTurn": { $lte: guarantee.expiresTurn },
              "bankCharter.resolutionClaimedTurn": { $exists: false },
              "bankCharter.depositorsResolvedTurn": { $exists: false },
            })),
          })
          .sort({ _id: 1 })
          .toArray()
      : [];
    for (const bank of banks) {
      const key = `${guarantee._id}:claim:${bank._id.toHexString()}`;
      const prior = await db.collection<{ _id: string }>("bankMoneyMoves").findOne({ _id: key });
      if (prior) continue;
      const amount = Math.min(
        available,
        guaranteedDepositorShortfall(
          bank.bankCharter!,
          savingsReadsAuthoritative(policy, guarantee.currency)
        )
      );
      if (!(amount > 0)) continue;
      const result = await settleTransition(db, {
        key,
        kind: "financial_crisis_guarantee_claim",
        turn,
        currency: guarantee.currency,
        legs: [
          {
            kind: "debit",
            amount,
            collection: "bankGuarantees",
            filter: { _id: guarantee._id },
            path: "escrowBalance",
            note: "Draw the funded guarantee",
          },
          {
            kind: "credit",
            amount,
            collection: "corporations",
            filter: {
              _id: oid(bank._id.toHexString()),
              countryId: guarantee.countryId as Corporation["countryId"],
              "bankCharter.charteredTurn": bank.bankCharter!.charteredTurn,
              "bankCharter.status": "failed",
              "bankCharter.currency": guarantee.currency,
              "bankCharter.failedTurn": { $lte: guarantee.expiresTurn },
              "bankCharter.resolutionClaimedTurn": { $exists: false },
              "bankCharter.depositorsResolvedTurn": { $exists: false },
            },
            path: "bankCharter.cashReserves",
            note: "Fund the existing secured-creditor and depositor waterfall",
          },
        ],
        projections: [
          {
            collection: "bankGuarantees",
            filter: { _id: guarantee._id },
            update: { $inc: { claimsPaid: amount } },
            note: "Record the settled claim",
          },
        ],
        event: { kind: "bank.resolved", command: "financial_crisis.guarantee_claim", amount },
      });
      if (result.error) throw new Error(result.error);
      available -= amount;
      summary.paid += amount;
    }
    if (turn <= guarantee.expiresTurn || !(available > 0)) continue;
    const source = refundSourceById.get(guarantee._id);
    if (!source) continue;
    const refundBudget = refundBudgetById.get(String(source.treasuryId));
    if (
      !refundBudget ||
      refundBudget.countryId !== guarantee.countryId ||
      resolveCountryCurrencyCode(refundBudget) !== guarantee.currency
    )
      continue;
    const currencyCodePresent = Object.hasOwn(refundBudget, "currencyCode");
    if (
      source.currencyCodePresent !== undefined &&
      (source.currencyCodePresent !== currencyCodePresent ||
        (currencyCodePresent && source.currencyCode !== refundBudget.currencyCode))
    )
      continue;
    const treasuryFilter = {
      _id: source.treasuryId,
      countryId: guarantee.countryId,
      currencyCode: exactOptionalField(currencyCodePresent, refundBudget.currencyCode),
    };
    const cashLedger = source.cashLedger;
    const result = await settleTransition(db, {
      key: `${guarantee._id}:expiry`,
      kind: "financial_crisis_guarantee_refund",
      turn,
      currency: guarantee.currency,
      legs: [
        {
          kind: "debit",
          amount: available,
          collection: "bankGuarantees",
          filter: { _id: guarantee._id },
          path: "escrowBalance",
          note: "Release unclaimed guarantee cash",
        },
        {
          kind: "credit",
          amount: available,
          collection: "federalBudget",
          filter: treasuryFilter,
          path: cashLedger ? "treasuryCashLocal" : "treasuryBalance",
          note: "Return unused coverage to its funding treasury",
        },
      ],
      projections: [
        ...(cashLedger
          ? [
              {
                collection: "federalBudget",
                filter: treasuryFilter,
                update: { $inc: { treasuryBalance: available } },
                note: "Keep the signed fiscal position aligned with refunded escrow",
              },
            ]
          : []),
        {
          collection: "bankGuarantees",
          filter: { _id: guarantee._id },
          update: { $set: { status: "expired", refunded: available } },
          note: "Close the expired guarantee",
        },
      ],
      event: {
        kind: "account.withdrawn",
        command: "financial_crisis.guarantee_refund",
        amount: available,
      },
    });
    if (result.error) throw new Error(result.error);
    summary.refunded += available;
  }
  return summary;
}

function hasFrozenRefundSource(guarantee: FundedGuarantee): boolean {
  return (
    guarantee.treasuryId !== undefined &&
    typeof guarantee.treasuryCashLedgerEnabled === "boolean" &&
    typeof guarantee.treasuryCurrencyCodePresent === "boolean" &&
    (!guarantee.treasuryCurrencyCodePresent ||
      typeof guarantee.treasuryCurrencyCode === "string" ||
      guarantee.treasuryCurrencyCode === null)
  );
}

function legacyRefundSource(
  guarantee: FundedGuarantee,
  move: GuaranteeFundingMove | undefined
): GuaranteeRefundSource | undefined {
  if (
    !move ||
    move.kind !== "financial_crisis_guarantee" ||
    move.status !== "applied" ||
    move.currency !== guarantee.currency
  )
    return undefined;
  const escrowCredit = move.legs.find(
    (leg) =>
      leg.kind === "credit" &&
      leg.applied === true &&
      leg.collection === "bankGuarantees" &&
      leg.path === "escrowBalance" &&
      leg.filter?._id === guarantee._id
  );
  if (!escrowCredit) return undefined;
  const debit = move.legs.find(
    (leg) =>
      leg.kind === "debit" &&
      leg.applied === true &&
      leg.amount === escrowCredit.amount &&
      leg.collection === "federalBudget" &&
      (leg.path === "treasuryCashLocal" || leg.path === "treasuryBalance") &&
      typeof leg.filter?._id === "string" &&
      leg.filter.countryId === guarantee.countryId
  );
  if (!debit || typeof debit.filter?._id !== "string") return undefined;
  return {
    treasuryId: debit.filter._id,
    cashLedger: debit.path === "treasuryCashLocal",
  };
}

function exactOptionalField<T>(present: boolean, value: T | undefined | null) {
  return present ? { $exists: true, $eq: value } : { $exists: false };
}
