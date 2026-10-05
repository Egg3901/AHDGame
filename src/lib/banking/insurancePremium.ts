import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  computeReserveRatioActual,
  getInsuredCap,
  sumInsuredPlayerDeposits,
} from "@/lib/banking/insurance";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { ensureFund } from "@/lib/banking/insurance";
import {
  computeEvidenceBasedPremiumAnnualRate,
  computeInsurancePremium,
} from "@/lib/banking/rules/insurance";
import { MONEY_MOVE_COLLECTION, turnMoveKey } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";

/**
 * Banking-turn inputs and compare filters for the insurance premium stage.
 * These helpers keep the turn runner on one bounded snapshot and ensure that
 * a premium retry cannot publish over a concurrent funded income receipt.
 */
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
  /** Refreshed original-epoch cash after resuming a previously claimed receipt. */
  cashReservesAfter?: number;
  /** Premium due beyond the bank's available cash. */
  shortfall: number;
  /** Whether the durable receipt applied its cash and exposure legs. */
  applied: boolean;
};

export type FrozenInsurancePremiumReceipt = {
  _id: string;
  status?: string;
  error?: string;
  legs?: {
    applied?: boolean;
    kind?: string;
    collection?: string;
    path?: string;
    filter?: Record<string, unknown>;
  }[];
  event?: {
    meta?: Record<string, unknown>;
  };
};

export async function loadInsurancePremiumReceiptsForTurn(
  db: Db,
  banks: readonly { bankId: ObjectId; charteredTurn: number }[],
  turn: number
): Promise<Map<string, FrozenInsurancePremiumReceipt>> {
  if (banks.length === 0) return new Map();
  const keys = banks.map(({ bankId, charteredTurn }) =>
    insurancePremiumReceiptKey(bankId, charteredTurn, turn)
  );
  const receipts = await db
    .collection<FrozenInsurancePremiumReceipt>(MONEY_MOVE_COLLECTION)
    .find({ _id: { $in: keys } })
    .toArray();
  return new Map(receipts.map((receipt) => [receipt._id, receipt]));
}

export function insurancePremiumReceiptKey(
  bankId: ObjectId,
  charteredTurn: number,
  turn: number
): string {
  return turnMoveKey("insurance-premium", `${bankId.toString()}:${charteredTurn}`, turn);
}

export function bankingTurnPublicationFilter(input: {
  bankId: ObjectId;
  countryId?: string | null;
  charteredTurn: number;
  currency: CurrencyCode;
  turn: number;
  observedIncomeTurn?: number;
  observedSovereignCouponIncome?: number;
  observedTreasuryRealizedGain?: number;
  observedSovereignCouponPaidLifetime?: number;
  observedSovereignCouponBookedLifetime?: number;
  observedTreasuryGainPaidLifetime?: number;
  observedTreasuryGainBookedLifetime?: number;
  observedUnderwritingFeesTurn?: number;
  observedUnderwritingFees?: number;
}): Record<string, unknown> {
  return {
    _id: input.bankId,
    ...(input.countryId === undefined
      ? { countryId: { $exists: false } }
      : { countryId: input.countryId }),
    "bankCharter.status": "active",
    "bankCharter.charteredTurn": input.charteredTurn,
    "bankCharter.currency": input.currency,
    ...(input.observedIncomeTurn === undefined
      ? { "bankCharter.lastBankingIncomeTurn": { $exists: false } }
      : { "bankCharter.lastBankingIncomeTurn": input.observedIncomeTurn }),
    ...(input.observedSovereignCouponIncome === undefined
      ? { "bankCharter.lastBankingSovereignCouponIncome": { $exists: false } }
      : {
          "bankCharter.lastBankingSovereignCouponIncome": input.observedSovereignCouponIncome,
        }),
    ...(input.observedTreasuryRealizedGain === undefined
      ? { "bankCharter.lastBankingTreasuryRealizedGain": { $exists: false } }
      : { "bankCharter.lastBankingTreasuryRealizedGain": input.observedTreasuryRealizedGain }),
    ...(input.observedSovereignCouponPaidLifetime === undefined
      ? { "bankCharter.sovereignCouponIncomePaidLifetime": { $exists: false } }
      : {
          "bankCharter.sovereignCouponIncomePaidLifetime":
            input.observedSovereignCouponPaidLifetime,
        }),
    ...(input.observedSovereignCouponBookedLifetime === undefined
      ? { "bankCharter.sovereignCouponIncomeBookedLifetime": { $exists: false } }
      : {
          "bankCharter.sovereignCouponIncomeBookedLifetime":
            input.observedSovereignCouponBookedLifetime,
        }),
    ...(input.observedTreasuryGainPaidLifetime === undefined
      ? { "bankCharter.treasuryRealizedGainPaidLifetime": { $exists: false } }
      : { "bankCharter.treasuryRealizedGainPaidLifetime": input.observedTreasuryGainPaidLifetime }),
    ...(input.observedTreasuryGainBookedLifetime === undefined
      ? { "bankCharter.treasuryRealizedGainBookedLifetime": { $exists: false } }
      : {
          "bankCharter.treasuryRealizedGainBookedLifetime":
            input.observedTreasuryGainBookedLifetime,
        }),
    ...(input.observedUnderwritingFeesTurn === undefined
      ? { "bankCharter.lastBankingUnderwritingFeesTurn": { $exists: false } }
      : { "bankCharter.lastBankingUnderwritingFeesTurn": input.observedUnderwritingFeesTurn }),
    ...(input.observedUnderwritingFees === undefined
      ? { "bankCharter.lastBankingUnderwritingFees": { $exists: false } }
      : { "bankCharter.lastBankingUnderwritingFees": input.observedUnderwritingFees }),
    $or: [
      { "bankCharter.lastBankingTurn": { $ne: input.turn } },
      { "bankCharter.lastBankingTurn": { $exists: false } },
    ],
  };
}

export async function insurancePremiumBasisForTurn(
  db: Db,
  input: {
    currency: CurrencyCode;
    depositorSavings: readonly { id: string; balance: number }[];
    interestPaidByDepositor: ReadonlyMap<string, number>;
    npcDeposits: number;
    playerDepositsAreLiabilities: boolean;
    playerDeposits: number;
    playerInterestSettled: number;
    cashReserves: number;
  }
): Promise<{
  insuredDeposits: number;
  playerCashDeposits: number;
  reserveRatioActual: number;
  reserveRatioRequired: number;
}> {
  const postInterestBalances = input.depositorSavings.map(
    ({ id, balance }) => balance + (input.interestPaidByDepositor.get(id) ?? 0)
  );
  const insuredCap = await getInsuredCap(db, input.currency);
  const insuredDeposits =
    sumInsuredPlayerDeposits(postInterestBalances, insuredCap) + input.npcDeposits;
  // In pointer mode the bank does not hold player savings, so reserves cover
  // only the NPC book. Authoritative player accounts are also vault liabilities.
  const playerCashDeposits = input.playerDepositsAreLiabilities
    ? input.playerDeposits + input.playerInterestSettled
    : 0;
  const depositBaseForRatio = input.npcDeposits + playerCashDeposits;
  return {
    insuredDeposits,
    playerCashDeposits,
    reserveRatioActual: computeReserveRatioActual(input.cashReserves, depositBaseForRatio),
    reserveRatioRequired: await getReserveRequirement(db, input.currency),
  };
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
  const bankId = meta.bankId;
  const charteredTurn = Number(meta.charteredTurn);
  const currency = meta.currency;
  const countryIdWasPresent = meta.countryIdWasPresent;
  const countryId = meta.countryId;
  if (
    ![
      insuredDeposits,
      reserveRatioActual,
      reserveRatioRequired,
      premiumBaseRate,
      premiumDue,
      premiumPaid,
      shortfall,
      charteredTurn,
    ].every(Number.isFinite) ||
    typeof bankId !== "string" ||
    typeof currency !== "string" ||
    typeof countryIdWasPresent !== "boolean" ||
    (countryIdWasPresent && countryId !== null && typeof countryId !== "string") ||
    premiumDue < 0 ||
    premiumPaid < 0 ||
    premiumPaid > premiumDue ||
    shortfall < 0
  )
    return null;
  return {
    insuredDeposits,
    premiumDue,
    premiumPaid,
    shortfall,
  };
}

async function readOriginalCharterCash(
  db: Db,
  receipt: FrozenInsurancePremiumReceipt,
  input: SettleInsurancePremiumInput
): Promise<number> {
  const meta = receipt.event?.meta;
  if (
    !quoteFromReceipt(receipt) ||
    !meta ||
    meta.bankId !== input.bankId.toString() ||
    typeof meta.charteredTurn !== "number" ||
    typeof meta.currency !== "string" ||
    typeof meta.countryIdWasPresent !== "boolean"
  ) {
    throw new Error("Insurance premium retry has no valid original charter guard");
  }
  const countryFilter = meta.countryIdWasPresent
    ? { countryId: meta.countryId }
    : { countryId: { $exists: false } };
  const originalDebit = receipt.legs?.find(
    (leg) => leg.kind === "debit" && leg.collection === "corporations"
  );
  const frozenFilter = originalDebit?.filter;
  if (
    originalDebit &&
    (!frozenFilter ||
      originalDebit.path !== "bankCharter.cashReserves" ||
      String(frozenFilter._id) !== input.bankId.toString() ||
      frozenFilter["bankCharter.status"] !== "active" ||
      frozenFilter["bankCharter.charteredTurn"] !== meta.charteredTurn ||
      frozenFilter["bankCharter.currency"] !== meta.currency)
  ) {
    throw new Error("Insurance premium receipt's source-charter guard is malformed");
  }
  const bank = await db.collection("corporations").findOne(
    frozenFilter ?? {
      _id: input.bankId,
      ...countryFilter,
      "bankCharter.status": "active",
      "bankCharter.charteredTurn": meta.charteredTurn,
      "bankCharter.currency": meta.currency,
    },
    { projection: { "bankCharter.cashReserves": 1 } }
  );
  const cash = bank?.bankCharter?.cashReserves;
  if (typeof cash !== "number" || !Number.isFinite(cash) || cash < 0) {
    throw new Error("Original bank charter is unavailable for insurance premium retry");
  }
  return cash;
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
      ...(quote.premiumPaid > 0
        ? { cashReservesAfter: await readOriginalCharterCash(db, existing, input) }
        : {}),
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
        bankId: input.bankId.toString(),
        charteredTurn: input.charteredTurn,
        currency: input.currency,
        countryIdWasPresent: input.countryId !== undefined,
        ...(input.countryId !== undefined ? { countryId: input.countryId } : {}),
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
    return {
      ...quote,
      cashDebited: 0,
      ...(quote.premiumPaid > 0
        ? { cashReservesAfter: await readOriginalCharterCash(db, winner, input) }
        : {}),
      applied: true,
    };
  }

  if (receipt.status !== "applied") {
    throw new Error(receipt.error ?? "Insurance premium settlement is awaiting recovery");
  }

  if (
    receipt.appliedLegs.length !== (premiumPaid > 0 ? 2 : 0) ||
    receipt.appliedProjections.length === 0
  ) {
    throw new Error("Insurance premium receipt did not finish every frozen leg and projection");
  }
  return {
    insuredDeposits: input.insuredDeposits,
    premiumPaid,
    premiumDue,
    cashDebited: receipt.appliedLegs.includes(0) ? premiumPaid : 0,
    shortfall,
    applied: true,
  };
}
