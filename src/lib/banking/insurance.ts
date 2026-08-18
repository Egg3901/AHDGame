/**
 * Deposit insurance: era-anchored insured cap, risk-weighted premiums, and
 * failed-bank depositor resolution with a Treasury backstop.
 *
 * Failure resolution itself lives in `depositBookReturn.ts`, which every way a
 * deposit book can end now shares. What stays here is the premium machinery,
 * the insured cap, the fund, and the failure-specific wrapper.
 *
 * Money model, in one line: the household deposit book is cash and must be
 * returned as cash, funded from the bank, then the fund, then the treasury;
 * player savings are a pointer and are returned by flipping the pointer.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { DepositInsuranceFund } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { emitTx } from "@/lib/financialTxLog/emit";
import { returnDepositBook } from "@/lib/banking/depositBookReturn";
import {
  getGdpAnchorRate,
  loadWorldEraUnitScale,
  loadWorldPreset,
} from "@/lib/currency/gdpAnchorRate";

/** Modern-era USD reference insured cap. Era/FX scaled at call time. */
export const INSURED_CAP_REFERENCE_USD = 5_000_000;

/** Provisional annual premium rate on insured deposits (before risk weight). */
export const BASE_PREMIUM_ANNUAL = 0.004;

/** Federal budget spending.byCategory key for Treasury insurance backstop. */
export { DEPOSIT_INSURANCE_SPENDING_KEY } from "@/lib/banking/depositBookReturn";

export type ResolveFailedBankDepositorsResult = {
  resolved: boolean;
  /** Player depositors whose holder was flipped (0 when skipped). */
  depositorsResolved: number;
  /** Fund balance drawn + Treasury backstop used to re-back totalKept. */
  insurancePaid: number;
  /** Total face value haircut applied to player excess above the cap. */
  haircutsApplied: number;
  /** Recovery pool extracted from the failed corp. */
  recoveryUsed: number;
  /** Treasury backstop portion of insurancePaid. */
  treasuryBackstop: number;
  /** NPC deposits returned to externalBroadMoney. */
  npcReturned: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Insured deposit cap in `currency` face value.
 *
 * Base is {@link INSURED_CAP_REFERENCE_USD} in USD-1953 reference terms,
 * deflated by the world's era unit scale, then converted via
 * {@link getGdpAnchorRate} (local = anchor / rate). Same path as charter capital.
 */
export async function getInsuredCap(db: Db, currency: CurrencyCode): Promise<number> {
  const [eraUnitScale, preset] = await Promise.all([
    loadWorldEraUnitScale(db),
    loadWorldPreset(db),
  ]);
  const scale = eraUnitScale > 0 && Number.isFinite(eraUnitScale) ? eraUnitScale : 1;
  const countryId = getCountryIdForCurrency(currency);
  const rate = getGdpAnchorRate(countryId, preset);
  const safeRate = rate > 0 && Number.isFinite(rate) ? rate : 1;
  const anchor = INSURED_CAP_REFERENCE_USD / scale;
  return Math.max(1, Math.round(anchor / safeRate));
}

/**
 * Pure per-turn premium on insured deposits, risk-weighted by reserve cover.
 *
 *   riskWeight = clamp(2 - actual / max(required, 0.01), 0.5, 3)
 *   premium = insuredDeposits * BASE_PREMIUM_ANNUAL / TURNS_PER_YEAR * riskWeight
 *
 * Thin reserves (actual << required) pay more; well-reserved banks pay less.
 */
export function computeInsurancePremium(
  insuredDeposits: number,
  reserveRatioActual: number,
  reserveRatioRequired: number
): number {
  const deposits =
    typeof insuredDeposits === "number" && Number.isFinite(insuredDeposits)
      ? Math.max(0, insuredDeposits)
      : 0;
  if (!(deposits > 0)) return 0;

  const actual =
    typeof reserveRatioActual === "number" && Number.isFinite(reserveRatioActual)
      ? Math.max(0, reserveRatioActual)
      : 0;
  const required =
    typeof reserveRatioRequired === "number" && Number.isFinite(reserveRatioRequired)
      ? reserveRatioRequired
      : 0;
  const riskWeight = clamp(2 - actual / Math.max(required, 0.01), 0.5, 3);
  return (deposits * BASE_PREMIUM_ANNUAL * riskWeight) / TURNS_PER_YEAR;
}

/**
 * Upsert the currency's deposit insurance fund. Sets era-anchored insuredCap
 * only on first touch ($setOnInsert).
 */
export async function ensureFund(db: Db, currency: CurrencyCode): Promise<DepositInsuranceFund> {
  const insuredCap = await getInsuredCap(db, currency);
  const col = db.collection<DepositInsuranceFund>("depositInsuranceFunds");
  await col.updateOne(
    { _id: currency },
    {
      $setOnInsert: {
        balance: 0,
        insuredCap,
        premiumsCollectedLifetime: 0,
        payoutsLifetime: 0,
        treasuryBackstopLifetime: 0,
      },
    },
    { upsert: true }
  );
  const doc = await col.findOne({ _id: currency });
  if (doc) return doc;
  // Driver/mocks that do not materialize upserts still get a usable shape.
  return {
    _id: currency,
    balance: 0,
    insuredCap,
    premiumsCollectedLifetime: 0,
    payoutsLifetime: 0,
    treasuryBackstopLifetime: 0,
  };
}

/**
 * Resolve a failed bank's deposit book.
 *
 * The whole waterfall now lives in `depositBookReturn.ts`, which is the single
 * path shared with revocation, admin unwind and a charter switch away from
 * deposit taking. This wrapper keeps the failure-specific claim (the
 * `depositorsResolvedTurn` stamp) and the failure-specific reporting.
 *
 * ## What changed for players, and why
 *
 * The old resolution haircut player savings and then had the insurance fund pay
 * for the balances it did not haircut. Player savings are a POINTER: the money
 * never left the character, so the haircut destroyed money that the bank had
 * never received and the insurance payment created money that reached nobody.
 * Neither leg had a counterparty, which is the disease this release is treating.
 *
 * A failed bank now costs a player depositor the yield and the counterparty,
 * not the principal, and deposit insurance stands behind the household book,
 * which is the part that is actually made of cash.
 */
export async function resolveFailedBankDepositors(
  db: Db,
  corporationId: ObjectId,
  turn: number
): Promise<ResolveFailedBankDepositorsResult> {
  const empty: ResolveFailedBankDepositorsResult = {
    resolved: false,
    depositorsResolved: 0,
    insurancePaid: 0,
    haircutsApplied: 0,
    recoveryUsed: 0,
    treasuryBackstop: 0,
    npcReturned: 0,
  };

  // Claim first, exactly as before: on a database with no transactions the only
  // safe order is to make a retry a no-op BEFORE any money moves. At most once,
  // deliberately, because a half-finished resolution is visible and repairable
  // while a double payout is neither.
  const claimed = await db.collection<Corporation>("corporations").findOneAndUpdate(
    {
      _id: corporationId,
      "bankCharter.status": "failed",
      $or: [
        { "bankCharter.depositorsResolvedTurn": { $exists: false } },
        { "bankCharter.depositorsResolvedTurn": null },
      ],
    },
    { $set: { "bankCharter.depositorsResolvedTurn": turn, updatedAt: new Date() } },
    { returnDocument: "before" }
  );
  if (!claimed?.bankCharter) return empty;

  await ensureFund(db, claimed.bankCharter.currency as CurrencyCode);

  const result = await returnDepositBook(db, corporationId, {
    cause: "failure",
    turn,
    // A failed bank's shareholders are last in line and, by definition of
    // failure, there is nothing left for them. Never release a residual here.
    releaseResidualToOwner: false,
  });

  if (result.fromInsuranceFund > 0 || result.fromTreasury > 0) {
    await emitTx(db, {
      type: "bank_insurance_payout",
      turn,
      createdAt: new Date(),
      subjectType: "government",
      countryId: getCountryIdForCurrency(claimed.bankCharter.currency as CurrencyCode),
      subjectName: `${claimed.bankCharter.currency} deposit insurance`,
      amount: -(result.fromInsuranceFund + result.fromTreasury),
      currencyCode: claimed.bankCharter.currency as CurrencyCode,
      counterpartyType: "system",
      counterpartyName: "Household depositors",
      meta: {
        kind: "fund_payout",
        bankCorporationId: corporationId.toString(),
        treasuryBackstop: result.fromTreasury,
      },
    });
  }

  return {
    resolved: true,
    depositorsResolved: result.depositorsFlipped,
    insurancePaid: result.fromInsuranceFund + result.fromTreasury,
    // Player principal is never haircut on this path. Kept in the result shape
    // so callers and dashboards that read it do not have to change.
    haircutsApplied: 0,
    recoveryUsed: result.fromBankCash,
    treasuryBackstop: result.fromTreasury,
    npcReturned: result.npcReturned,
  };
}

/** Helper for bankingTurn: sum of min(balance, cap) over player depositors. */
export function sumInsuredPlayerDeposits(balances: readonly number[], insuredCap: number): number {
  const cap = Math.max(0, insuredCap);
  let total = 0;
  for (const bal of balances) {
    if (!(bal > 0)) continue;
    total += Math.min(bal, cap);
  }
  return total;
}

/** Actual reserve ratio used for premium risk weight (liquid / deposits). */
export function computeReserveRatioActual(liquidCapital: number, totalDeposits: number): number {
  const deposits = Math.max(0, totalDeposits);
  if (!(deposits > 0)) return 1;
  return Math.max(0, liquidCapital) / deposits;
}
