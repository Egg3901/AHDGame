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

interface FundedGuarantee {
  _id: string;
  countryId: string;
  currency: string;
  bankIds: ObjectId[];
  escrowBalance: number;
  expiresTurn: number;
  status: "pending" | "active" | "expired";
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
  // Resolve all possible refund identities once, before any escrow debit.
  const expiredCountries = [
    ...new Set(
      guarantees
        .filter((guarantee) => turn > guarantee.expiresTurn)
        .map((guarantee) => guarantee.countryId)
    ),
  ];
  const refundBudgets = expiredCountries.length
    ? await db
        .collection<FederalBudget>("federalBudget")
        .find({ countryId: { $in: expiredCountries } }, { projection: { _id: 1, countryId: 1 } })
        .toArray()
    : [];
  const refundBudgetIds = new Map(refundBudgets.map((budget) => [budget.countryId, budget._id]));
  for (const guarantee of guarantees) {
    let available = guarantee.escrowBalance;
    const banks = await db
      .collection<Corporation>("corporations")
      .find({
        _id: { $in: guarantee.bankIds },
        "bankCharter.status": "failed",
        "bankCharter.currency": guarantee.currency,
        "bankCharter.failedTurn": { $lte: guarantee.expiresTurn },
        "bankCharter.resolutionClaimedTurn": { $exists: false },
        "bankCharter.depositorsResolvedTurn": { $exists: false },
      })
      .sort({ _id: 1 })
      .toArray();
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
            filter: { _id: oid(bank._id.toHexString()) },
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
    const treasuryId = refundBudgetIds.get(guarantee.countryId);
    if (!treasuryId) throw new Error("Guarantee refund treasury is unavailable");
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
          filter: { _id: treasuryId, countryId: guarantee.countryId },
          path: policy.treasuryCashLedger ? "treasuryCashLocal" : "treasuryBalance",
          note: "Return unused coverage to its funding treasury",
        },
      ],
      projections: [
        ...(policy.treasuryCashLedger
          ? [
              {
                collection: "federalBudget",
                filter: { _id: treasuryId, countryId: guarantee.countryId },
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
