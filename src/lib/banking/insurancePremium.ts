import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { ensureFund } from "@/lib/banking/insurance";
import {
  computeEvidenceBasedPremiumAnnualRate,
  computeInsurancePremium,
} from "@/lib/banking/rules/insurance";
import { turnMoveKey } from "@/lib/banking/moneyMove";
import { settleTransition } from "@/lib/banking/settlementJournal";

export type SettleInsurancePremiumInput = {
  bankId: ObjectId;
  countryId?: string | null;
  charteredTurn: number;
  currency: CurrencyCode;
  turn: number;
  insuredDeposits: number;
  cashReserves: number;
  reserveRatioActual: number;
  reserveRatioRequired: number;
};

export type SettleInsurancePremiumResult = {
  /** Cash actually debited from the frozen bank charter. */
  paid: number;
  /** Premium due beyond the bank's available cash. */
  shortfall: number;
  /** Whether the durable receipt applied its cash and exposure legs. */
  applied: boolean;
};

/**
 * Price and settle one charter epoch's insurance premium and exposure receipt.
 * The epoch and denomination guard bind the source debit; the durable key also
 * makes zero-cash exposure recording idempotent for the same bank-turn.
 */
export async function settleInsurancePremiumForTurn(
  db: Db,
  input: SettleInsurancePremiumInput
): Promise<SettleInsurancePremiumResult> {
  if (!(input.insuredDeposits > 0)) return { paid: 0, shortfall: 0, applied: true };

  const fund = await ensureFund(db, input.currency);
  const premiumBaseRate = computeEvidenceBasedPremiumAnnualRate({
    currentTurn: input.turn,
    firstMeasuredTurn: fund.pricingEvidenceStartTurn ?? input.turn,
    insuredDepositTurns: fund.insuredDepositExposureTurnsLifetime ?? 0,
    paidClaims: fund.measuredPaidClaimsSincePricingStart ?? 0,
    grossPayouts: fund.measuredGrossClaimsSincePricingStart ?? 0,
    recoveries: fund.measuredRecoveriesSincePricingStart ?? 0,
    fundBalance: fund.balance,
  });
  const premiumDue = computeInsurancePremium(
    input.insuredDeposits,
    input.reserveRatioActual,
    input.reserveRatioRequired,
    premiumBaseRate
  );
  const availableCash = Number.isFinite(input.cashReserves) ? Math.max(0, input.cashReserves) : 0;
  const premiumPaid = Math.min(premiumDue, availableCash);
  const shortfall = premiumDue - premiumPaid;
  const countryFilter =
    input.countryId === undefined
      ? { countryId: { $exists: false } }
      : { countryId: input.countryId };

  const receipt = await settleTransition(db, {
    key: turnMoveKey(
      "insurance-premium",
      `${input.bankId.toString()}:${input.charteredTurn}`,
      input.turn
    ),
    kind: "insurance_premium",
    turn: input.turn,
    currency: input.currency,
    legs:
      premiumPaid > 0
        ? [
            {
              kind: "debit",
              amount: premiumPaid,
              collection: "corporations",
              filter: {
                _id: input.bankId,
                ...countryFilter,
                "bankCharter.status": "active",
                "bankCharter.charteredTurn": input.charteredTurn,
                "bankCharter.currency": input.currency,
              },
              path: "bankCharter.cashReserves",
              note: "insurance premium leaves the original bank charter",
            },
            {
              kind: "credit",
              amount: premiumPaid,
              collection: "depositInsuranceFunds",
              filter: { _id: input.currency },
              path: "balance",
              note: "premium into the currency's insurance fund",
            },
          ]
        : [],
    projections: [
      {
        collection: "depositInsuranceFunds",
        filter: { _id: input.currency },
        update: {
          $inc: { insuredDepositExposureTurnsLifetime: input.insuredDeposits },
          $min: { pricingEvidenceStartTurn: input.turn },
        },
        note: "Record this charter epoch's insured currency exposure once",
      },
      ...(premiumPaid > 0
        ? [
            {
              collection: "depositInsuranceFunds",
              filter: { _id: input.currency },
              update: { $inc: { premiumsCollectedLifetime: premiumPaid } },
              note: "lifetime premium counter follows the cash",
            },
          ]
        : []),
    ],
    event: {
      kind: "account.withdrawn",
      command: "bank.insurance.premium",
      amount: premiumPaid,
      meta: {
        insuredDeposits: input.insuredDeposits,
        reserveRatioActual: input.reserveRatioActual,
        reserveRatioRequired: input.reserveRatioRequired,
        premiumBaseRate,
      },
    },
  });

  const applied =
    receipt.status === "applied" &&
    receipt.appliedLegs.length === (premiumPaid > 0 ? 2 : 0) &&
    receipt.appliedProjections.length > 0;
  return {
    paid: applied ? premiumPaid : 0,
    shortfall,
    applied,
  };
}
