import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { ensureFund } from "@/lib/banking/insurance";
import {
  computeEvidenceBasedPremiumAnnualRate,
  computeInsurancePremium,
} from "@/lib/banking/rules/insurance";
import { MONEY_MOVE_COLLECTION, turnMoveKey } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";

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
  /** Insured deposit exposure frozen by the original bank-turn receipt. */
  insuredDeposits: number;
  /** The premium amount frozen by the original bank-turn receipt. */
  premiumPaid: number;
  /** The premium due frozen by the original bank-turn receipt. */
  premiumDue: number;
  /** Cash debited during this invocation, for the caller's in-memory balance. */
  cashDebited: number;
  /** Premium due beyond the bank's available cash. */
  shortfall: number;
  /** Whether the durable receipt applied its cash and exposure legs. */
  applied: boolean;
};

export type FrozenInsurancePremiumReceipt = {
  _id: string;
  status?: string;
  error?: string;
  legs?: { applied?: boolean }[];
  event?: {
    meta?: Record<string, unknown>;
  };
};

export function insurancePremiumReceiptKey(
  bankId: ObjectId,
  charteredTurn: number,
  turn: number
): string {
  return turnMoveKey("insurance-premium", `${bankId.toString()}:${charteredTurn}`, turn);
}

function quoteFromReceipt(receipt: FrozenInsurancePremiumReceipt) {
  const meta = receipt.event?.meta;
  if (!meta) return null;
  const insuredDeposits = Number(meta.insuredDeposits);
  const reserveRatioActual = Number(meta.reserveRatioActual);
  const reserveRatioRequired = Number(meta.reserveRatioRequired);
  const premiumBaseRate = Number(meta.premiumBaseRate);
  const premiumDue = Number(meta.premiumDue);
  const premiumPaid = Number(meta.premiumPaid);
  const shortfall = Number(meta.shortfall);
  if (
    ![
      insuredDeposits,
      reserveRatioActual,
      reserveRatioRequired,
      premiumBaseRate,
      premiumDue,
      premiumPaid,
      shortfall,
    ].every(Number.isFinite) ||
    premiumDue < 0 ||
    premiumPaid < 0 ||
    premiumPaid > premiumDue ||
    shortfall < 0
  )
    return null;
  return { insuredDeposits, premiumDue, premiumPaid, shortfall };
}

/**
 * Price and settle one charter epoch's insurance premium and exposure receipt.
 * The epoch and denomination guard bind the source debit; the durable key also
 * makes zero-cash exposure recording idempotent for the same bank-turn.
 */
export async function settleInsurancePremiumForTurn(
  db: Db,
  input: SettleInsurancePremiumInput,
  priorReceipt?: FrozenInsurancePremiumReceipt | null
): Promise<SettleInsurancePremiumResult> {
  const key = insurancePremiumReceiptKey(input.bankId, input.charteredTurn, input.turn);
  let existing = priorReceipt;
  if (existing === undefined) {
    existing = await db
      .collection<FrozenInsurancePremiumReceipt>(MONEY_MOVE_COLLECTION)
      .findOne({ _id: key });
  }

  if (existing) {
    const quote = quoteFromReceipt(existing);
    if (!quote) {
      throw new Error("Existing insurance premium receipt has no valid frozen quote");
    }
    if (existing.status === "rejected") {
      throw new Error(existing.error ?? "Insurance premium receipt was rejected");
    }
    const receipt = await resumeSettlement(db, key);
    if (receipt.status !== "applied") {
      throw new Error(receipt.error ?? "Insurance premium settlement is awaiting recovery");
    }
    return {
      ...quote,
      cashDebited: 0,
      applied: true,
    };
  }

  if (!(input.insuredDeposits > 0))
    return {
      insuredDeposits: 0,
      premiumPaid: 0,
      premiumDue: 0,
      cashDebited: 0,
      shortfall: 0,
      applied: true,
    };

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
    key,
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
        premiumDue,
        premiumPaid,
        shortfall,
      },
    },
  });

  if (receipt.status === "replayed") {
    const winner = await db
      .collection<FrozenInsurancePremiumReceipt>(MONEY_MOVE_COLLECTION)
      .findOne({ _id: key });
    const quote = winner ? quoteFromReceipt(winner) : null;
    if (!winner || !quote) {
      throw new Error("Concurrent insurance premium receipt has no valid frozen quote");
    }
    if (winner.status === "rejected") {
      throw new Error(winner.error ?? "Concurrent insurance premium receipt was rejected");
    }
    const resumed = await resumeSettlement(db, key);
    if (resumed.status !== "applied") {
      throw new Error(
        resumed.error ?? "Concurrent insurance premium settlement is awaiting recovery"
      );
    }
    return { ...quote, cashDebited: 0, applied: true };
  }

  if (receipt.status !== "applied") {
    throw new Error(receipt.error ?? "Insurance premium settlement is awaiting recovery");
  }

  const applied =
    receipt.appliedLegs.length === (premiumPaid > 0 ? 2 : 0) &&
    receipt.appliedProjections.length > 0;
  return {
    insuredDeposits: input.insuredDeposits,
    premiumPaid,
    premiumDue,
    cashDebited: receipt.appliedLegs.includes(0) ? premiumPaid : 0,
    shortfall,
    applied,
  };
}
