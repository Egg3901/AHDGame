/**
 * Deposit insurance: era-anchored insured cap, risk-weighted premiums, and
 * failed-bank depositor resolution with a Treasury backstop.
 *
 * Failure resolution money model (deliberately explicit):
 *   The failed bank's books die. Recovery pool = max(0, cashReserves) +
 *   postedCapital; both are zeroed on the corp. Every kept player balance and
 *   every returned NPC deposit must be re-backed. totalKept = sum(insured +
 *   paidExcess) + npcDeposits is funded in priority order from (1) recovery
 *   pool, (2) the currency's depositInsuranceFunds.balance, (3) the country's
 *   federalBudget (treasuryBalance debit + spending.byCategory.depositInsurance).
 *   NPC deposits credit externalBroadMoney in full. Player savings numbers that
 *   survive stay as numbers; the funding sources are their named debit. Excess
 *   above the insured cap is paid pro rata from recovery remaining after the
 *   insured gap; unpaid excess is a haircut. Holders flip to "centralBank".
 */

import type { Db, ObjectId } from "mongodb";
import type { Character, Corporation, FederalBudget } from "@/lib/db/types";
import type { DepositInsuranceFund } from "@/lib/db/types/bank";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getBankId } from "@/lib/centralBank/helpers";
import { emitTx, emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { getCashReserves } from "@/lib/banking/bankCash";
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
export const DEPOSIT_INSURANCE_SPENDING_KEY = "depositInsurance";

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
 * Resolve depositors of a failed bank.
 *
 * ## The idempotency key is CLAIMED FIRST, on purpose
 *
 * It used to be stamped in step (e), after the depositor haircuts in (b) and
 * (c). On a database with no transactions (see `ahd-standalone-mongo-no-txns`)
 * that leaves a window: a crash between the haircut bulkWrite and the stamp
 * lets a retry run the whole resolution again and haircut every depositor a
 * SECOND time. Money taken from players twice, with no record that it happened.
 *
 * The claim is now an atomic `findOneAndUpdate` before anything is touched, so
 * at most one runner ever proceeds.
 *
 * That is deliberately AT MOST once rather than at least once. The two failure
 * modes are not symmetric: a double haircut silently confiscates player money
 * and cannot be detected after the fact, while a resolution that stops half way
 * leaves a bank visibly stuck in `failed` with depositors still pointed at it,
 * which an admin can see and heal. Prefer the recoverable failure.
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

  // Claim the resolution atomically. The filter is the guard: only a failed
  // charter with no stamp matches, so a concurrent or retried call gets null
  // and returns without touching a single depositor balance.
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
  const charter = claimed?.bankCharter;
  if (!claimed || !charter) return empty;
  const corp = claimed;

  const currency = charter.currency as CurrencyCode;
  const bankIdHex = corporationId.toString();
  const insuredCap = await getInsuredCap(db, currency);
  await ensureFund(db, currency);

  // (a) Recovery pool: the bank's ring-fenced cash, and only that.
  //
  // This used to be `liquidCapital + postedCapital`, back when the bank kept its
  // money in the corporation's treasury. Both halves of that are now wrong.
  // The corporation's cash is on the other side of the ring-fence and is not
  // available to depositors, and `postedCapital` is a memo of money that is
  // already counted inside `cashReserves`, so adding it would have paid
  // depositors twice out of a pot that only holds it once.
  const recoveryPool = getCashReserves(charter);
  // No stamp guard here any more: the claim above already stamped it, and
  // repeating that filter would match nothing and silently skip the write.
  // Serialization is the claim's job; this step just does the work.
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId, "bankCharter.status": "failed" },
    {
      $set: {
        "bankCharter.cashReserves": 0,
        "bankCharter.postedCapital": 0,
        updatedAt: new Date(),
      },
    }
  );

  // (b) Player depositors: keep insured whole; excess pro rata from recovery
  // remaining after the insured gap; unpaid excess is a haircut.
  const depositors = await db
    .collection<Character>("characters")
    .find({ [`currencyBalances.savingsHolder.${currency}`]: bankIdHex })
    .project({
      _id: 1,
      // `name` is for the haircut ledger legs below: a row saying only that an
      // ObjectId lost money is not auditable by anyone.
      name: 1,
      [`currencyBalances.savings.${currency}`]: 1,
    })
    .toArray();
  const nameByCharacterId = new Map(
    depositors.map((ch) => [ch._id.toString(), (ch as { name?: string }).name ?? "Depositor"])
  );

  type DepositorRow = {
    characterId: ObjectId;
    balance: number;
    insured: number;
    excess: number;
  };
  const rows: DepositorRow[] = [];
  let totalInsured = 0;
  let totalExcess = 0;
  for (const ch of depositors) {
    const balance = Math.max(0, ch.currencyBalances?.savings?.[currency] ?? 0);
    const insured = Math.min(balance, insuredCap);
    const excess = Math.max(0, balance - insured);
    rows.push({ characterId: ch._id, balance, insured, excess });
    totalInsured += insured;
    totalExcess += excess;
  }

  const availableForExcess = Math.max(0, recoveryPool - totalInsured);
  let haircutsApplied = 0;
  let playerKept = 0;
  const charOps: { updateOne: { filter: object; update: object } }[] = [];

  for (const row of rows) {
    const paidExcess =
      totalExcess > 0 && row.excess > 0 ? row.excess * (availableForExcess / totalExcess) : 0;
    const haircut = Math.max(0, row.excess - paidExcess);
    const kept = row.insured + paidExcess;
    haircutsApplied += haircut;
    playerKept += kept;

    const update: {
      $set: Record<string, unknown>;
      $inc?: Record<string, number>;
    } = {
      $set: {
        [`currencyBalances.savingsHolder.${currency}`]: "centralBank",
        updatedAt: new Date(),
      },
    };
    if (haircut > 0) {
      update.$inc = { [`currencyBalances.savings.${currency}`]: -haircut };
    }
    charOps.push({
      updateOne: {
        filter: { _id: row.characterId },
        update,
      },
    });
  }

  if (charOps.length > 0) {
    await db.collection("characters").bulkWrite(charOps);

    // A haircut is money that stops existing: the depositor's savings fall and
    // nobody receives the difference. `system` counterparty so it derives a
    // sink, rather than naming a recipient that does not exist. The kept
    // balances are deliberately NOT logged: they do not move, the resolution
    // only changes what backs them.
    const haircutRows = rows
      .map((row) => {
        const paidExcess =
          totalExcess > 0 && row.excess > 0 ? row.excess * (availableForExcess / totalExcess) : 0;
        return { row, haircut: Math.max(0, row.excess - paidExcess) };
      })
      .filter(({ haircut }) => haircut > 0);
    if (haircutRows.length > 0) {
      const thresholds = await loadTxThresholds(db);
      await emitTxBulk(
        db,
        haircutRows.map(({ row, haircut }) => ({
          type: "bank_insurance_payout" as const,
          turn,
          createdAt: new Date(),
          subjectType: "character" as const,
          subjectId: row.characterId,
          subjectName: nameByCharacterId.get(row.characterId.toString()) ?? "Depositor",
          amount: -haircut,
          currencyCode: currency,
          counterpartyType: "system" as const,
          counterpartyName: "Uninsured loss",
          meta: { kind: "haircut", bankCorporationId: corporationId.toString() },
        })),
        thresholds
      );
    }
  }

  // (d) NPC deposits: households are small and fully insured.
  const npcDeposits = Math.max(0, charter.npcDeposits ?? 0);
  const totalKept = playerKept + npcDeposits;

  // (c) Fund totalKept from recovery → fund → Treasury.
  let remaining = totalKept;
  const fromRecovery = Math.min(recoveryPool, remaining);
  remaining -= fromRecovery;

  const fund = await db
    .collection<DepositInsuranceFund>("depositInsuranceFunds")
    .findOne({ _id: currency });
  const fundBalance = Math.max(0, fund?.balance ?? 0);
  const fromFund = Math.min(fundBalance, remaining);
  remaining -= fromFund;

  const fromTreasury = Math.max(0, remaining);
  remaining = 0;

  if (fromFund > 0 || fromTreasury > 0) {
    await db.collection<DepositInsuranceFund>("depositInsuranceFunds").updateOne(
      { _id: currency },
      {
        $inc: {
          balance: -fromFund,
          payoutsLifetime: fromFund + fromTreasury,
          treasuryBackstopLifetime: fromTreasury,
        },
      }
    );
  }

  if (fromTreasury > 0) {
    await debitTreasuryDepositInsurance(db, currency, fromTreasury);
  }

  // What the fund and the taxpayer actually paid to keep insured balances whole.
  if (fromFund > 0) {
    await emitTx(db, {
      type: "bank_insurance_payout",
      turn,
      createdAt: new Date(),
      subjectType: "government",
      countryId: getCountryIdForCurrency(currency),
      subjectName: `${currency} deposit insurance fund`,
      amount: -fromFund,
      currencyCode: currency,
      counterpartyType: "system",
      counterpartyName: "Insured depositors",
      meta: { kind: "fund_payout", bankCorporationId: corporationId.toString() },
    });
  }
  if (fromTreasury > 0) {
    await emitTx(db, {
      type: "bank_insurance_payout",
      turn,
      createdAt: new Date(),
      subjectType: "government",
      countryId: getCountryIdForCurrency(currency),
      subjectName: `${getCountryIdForCurrency(currency)} treasury`,
      amount: -fromTreasury,
      currencyCode: currency,
      counterpartyType: "system",
      counterpartyName: "Insured depositors",
      meta: { kind: "treasury_backstop", bankCorporationId: corporationId.toString() },
    });
  }

  if (npcDeposits > 0) {
    const cbDocId = getBankId(getCountryIdForCurrency(currency));
    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: cbDocId },
      {
        $inc: { externalBroadMoney: npcDeposits },
        $set: { updatedAt: new Date() },
      }
    );
  }

  // (e) Zero the deposit aggregates. The idempotency key was already claimed
  // at the top, so this no longer stamps and no longer needs to detect a race:
  // a loser never reaches this line.
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId, "bankCharter.status": "failed" },
    {
      $set: {
        "bankCharter.npcDeposits": 0,
        "bankCharter.totalDeposits": 0,
        updatedAt: new Date(),
      },
    }
  );

  return {
    resolved: true,
    depositorsResolved: rows.length,
    insurancePaid: fromFund + fromTreasury,
    haircutsApplied,
    recoveryUsed: fromRecovery,
    treasuryBackstop: fromTreasury,
    npcReturned: npcDeposits,
  };
}

/**
 * Debit treasuryBalance and book the spend on spending.byCategory.depositInsurance.
 * Unconditional: an unaffordable backstop pushes the treasury into debt.
 */
async function debitTreasuryDepositInsurance(
  db: Db,
  currency: CurrencyCode,
  amount: number
): Promise<void> {
  if (!(amount > 0)) return;
  const countryId = getCountryIdForCurrency(currency);
  const budgetId = getNationalBudgetId(countryId);
  const now = new Date();
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budgetId },
    {
      $inc: {
        treasuryBalance: -amount,
        [`spending.byCategory.${DEPOSIT_INSURANCE_SPENDING_KEY}`]: amount,
        "spending.total": amount,
        surplus: -amount,
      },
      $set: { updatedAt: now },
    }
  );
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
