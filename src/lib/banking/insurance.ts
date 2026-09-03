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
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  depositBookReturnKey,
  freezeAccountsAt,
  returnDepositBook,
} from "@/lib/banking/depositBookReturn";
import { resumeSettlement } from "@/lib/banking/settlementJournal";
import { lifecycleStage } from "@/lib/banking/rules/lifecycle";
import {
  getGdpAnchorRate,
  loadWorldEraUnitScale,
  loadWorldPreset,
} from "@/lib/currency/gdpAnchorRate";

export {
  INSURED_CAP_REFERENCE_USD,
  BASE_PREMIUM_ANNUAL,
  computeInsurancePremium,
  sumInsuredPlayerDeposits,
  computeReserveRatioActual,
} from "@/lib/banking/rules/insurance";
import { INSURED_CAP_REFERENCE_USD } from "@/lib/banking/rules/insurance";

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
  /** Set when the waterfall could not settle; the estate stays `resolving` for recovery. */
  error?: string;
};

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

  // Claim first: on a database with no transactions the only safe order is to
  // make a concurrent attempt a no-op BEFORE any money moves. The claim is the
  // resolution stamp, not the settlement stamp: it moves the charter into the
  // `resolving` stage, where nothing is admitted but recovery, and the
  // settlement stamp lands with the waterfall's own projections. So an estate
  // that crashed between claim and settlement is visible as `resolving`, is
  // picked up again by the sweep, and finishes under the SAME idempotency key
  // (the claim turn), which is what makes the retry a completion rather than
  // a second payout.
  const now = new Date();
  const claimed = await db.collection<Corporation>("corporations").findOneAndUpdate(
    {
      _id: corporationId,
      "bankCharter.status": "failed",
      "bankCharter.resolutionClaimedTurn": { $exists: false },
      $or: [
        { "bankCharter.depositorsResolvedTurn": { $exists: false } },
        { "bankCharter.depositorsResolvedTurn": null },
      ],
    },
    { $set: { "bankCharter.resolutionClaimedTurn": turn, updatedAt: now } },
    { returnDocument: "after" }
  );
  let charter = claimed?.bankCharter ?? null;
  let recovering = false;
  if (!charter) {
    // Not ours to claim. Either another attempt holds it, or it is already
    // settled, or it was claimed earlier and never settled. Only the last is
    // ours: read it back and decide by stage.
    const current = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: corporationId }, { projection: { bankCharter: 1 } });
    const stage = lifecycleStage(current?.bankCharter);
    const claimedOn = current?.bankCharter?.resolutionClaimedTurn;
    // Recovery is for an estate claimed on an EARLIER turn. One claimed this
    // turn is in flight in another attempt (the sweep runs once per turn),
    // and running the waterfall beside it would only race it for the key.
    if (
      stage !== "resolving" ||
      current?.bankCharter?.status !== "failed" ||
      typeof claimedOn !== "number" ||
      claimedOn >= turn
    ) {
      return empty;
    }
    charter = current.bankCharter;
    recovering = true;
  }
  const claimTurn = charter.resolutionClaimedTurn ?? turn;
  const currency = charter.currency as CurrencyCode;

  // Freeze before the waterfall. Idempotent, so recovery freezes nothing new.
  await freezeAccountsAt(db, corporationId.toString(), currency, now);
  await ensureFund(db, currency);

  if (recovering) {
    // Whatever the earlier attempt left half-done is finished from its own
    // record first: legs that did not land, then projections. Only then does
    // the waterfall run again, as a replay that releases the accounts.
    const resumed = await resumeSettlement(
      db,
      depositBookReturnKey(corporationId, "failure", claimTurn)
    );
    if (resumed.status === "partial") {
      return { ...empty, error: resumed.error ?? "resolution could not be resumed" };
    }
  }
  const result = await returnDepositBook(db, corporationId, {
    cause: "failure",
    turn: claimTurn,
    // A failed bank's shareholders are last in line and, by definition of
    // failure, there is nothing left for them. Never release a residual here.
    releaseResidualToOwner: false,
  });
  if (result.error) {
    // Claimed, frozen, not settled: the sweep finds it again next turn as
    // `resolving`, and recovery runs this same function to completion.
    return { ...empty, error: result.error };
  }
  if (recovering && !result.returned) {
    // The money moved on the earlier attempt; the release just ran. Report
    // the recovery without inventing amounts.
    return { ...empty, resolved: true, depositorsResolved: result.depositorsFlipped };
  }

  if (result.fromInsuranceFund > 0 || result.fromTreasury > 0) {
    await emitTx(db, {
      type: "bank_insurance_payout",
      turn: claimTurn,
      createdAt: new Date(),
      subjectType: "government",
      countryId: getCountryIdForCurrency(currency),
      subjectName: `${currency} deposit insurance`,
      amount: -(result.fromInsuranceFund + result.fromTreasury),
      currencyCode: currency,
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
