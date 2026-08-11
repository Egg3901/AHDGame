import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION,
  IMF_BAILOUT_INCOME_FRACTION_CAP,
} from "@/lib/imf/constants";
import { computeImfFacilityPaymentTurn } from "@/lib/imf/imfFacilityMath";
import type { ImfFacilityReceivableRow } from "@/lib/corporations/imfPortfolioReceivables";
import { findImfFacilityReceivablesForLender } from "@/lib/corporations/imfPortfolioReceivables";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

const PRINCIPAL_EPS = 1e-6;

/**
 * Same cash payment (₳ per turn) as {@link processImfBailoutPayments} uses for a rescued corp,
 * given per-turn snapshot income (anchor units).
 */
export function imfFacilityPaymentAnchorPerTurn(
  corp: Pick<
    Corporation,
    | "imfBailoutActive"
    | "imfFacilityPrincipalOutstanding"
    | "imfFacilityAnnualRate"
    | "imfFacilityAmortizationTurnsRemaining"
    | "imfFacilityIncomeCaptureFraction"
  >,
  turnIncomeAnchor: number
): number {
  if (corp.imfBailoutActive !== true) return 0;
  const principal = corp.imfFacilityPrincipalOutstanding ?? 0;
  if (principal <= PRINCIPAL_EPS) return 0;

  const incomeCapFraction = Math.min(
    IMF_BAILOUT_INCOME_FRACTION_CAP,
    corp.imfFacilityIncomeCaptureFraction ?? IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION
  );

  const split = computeImfFacilityPaymentTurn({
    principalOutstanding: principal,
    annualRatePercent: corp.imfFacilityAnnualRate ?? 0,
    remainingTurns: corp.imfFacilityAmortizationTurnsRemaining ?? 48,
    turnIncome: turnIncomeAnchor,
    incomeCapFraction,
  });
  return split.actualPayment;
}

/**
 * Sum of IMF facility cash received by the lender this turn (anchor ₳), using each borrower's
 * latest corporationHistory `income` as the cap basis (matches turn processing).
 */
export async function sumImfLenderReceiptsAnchorPerTurnForReceivables(
  db: Db,
  receivables: ImfFacilityReceivableRow[]
): Promise<number> {
  if (receivables.length === 0) return 0;

  const borrowerIds = receivables.map((r) => new ObjectId(r.borrowerCorporationId));
  const incomeRows = await db
    .collection<{ corporationId: ObjectId; income?: number }>("corporationHistory")
    .aggregate<{ _id: ObjectId; income: number }>([
      { $match: { corporationId: { $in: borrowerIds } } },
      { $sort: { turn: -1 } },
      { $group: { _id: "$corporationId", income: { $first: "$income" } } },
    ])
    .toArray();
  const incomeByBorrower = new Map(
    incomeRows.map((r) => [r._id.toString(), typeof r.income === "number" ? r.income : 0])
  );

  let total = 0;
  for (const r of receivables) {
    const turnIncome = incomeByBorrower.get(r.borrowerCorporationId) ?? 0;
    const capture =
      r.incomeCaptureFraction != null
        ? Math.min(IMF_BAILOUT_INCOME_FRACTION_CAP, r.incomeCaptureFraction)
        : Math.min(IMF_BAILOUT_INCOME_FRACTION_CAP, IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION);
    const split = computeImfFacilityPaymentTurn({
      principalOutstanding: r.principalOutstanding,
      annualRatePercent: r.annualRatePercent,
      remainingTurns: r.amortizationTurnsRemaining,
      turnIncome,
      incomeCapFraction: capture,
    });
    total += split.actualPayment;
  }
  return total;
}

/**
 * Total IMF facility cash received by the lender this turn (anchor ₳).
 */
export async function totalImfLenderReceiptsAnchorPerTurn(
  db: Db,
  lenderCorporationId: ObjectId
): Promise<number> {
  const { receivables } = await findImfFacilityReceivablesForLender(db, lenderCorporationId);
  return sumImfLenderReceiptsAnchorPerTurnForReceivables(db, receivables);
}

/** Scale per-turn anchor flows to the same "daily" units as bond coupon lines on the corp page. */
export function anchorPerTurnToFinancialDaily(anchorPerTurn: number): number {
  return anchorPerTurn * TURNS_PER_DAY;
}
