import type { AnyBulkWriteOperation, ClientSession, Db, ObjectId } from "mongodb";
import type { BondMarketPool, Bond, IndexFund, IndexFundTransaction } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import { reserveBondUnitsForHolder } from "@/lib/bonds/bondHolderOps";
import { emitTx, type TxInput } from "@/lib/financialTxLog/emit";
import type { TxThresholds } from "@/lib/db/types/financialTxLog";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { sovereignBondCapError } from "@/lib/bonds/holderCap";
import { creditBondPool, loadBondQuote, advanceBondPoolSnapshot } from "@/lib/bonds/marketPool";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";

export type PurchaseBondUnitsForFundResult =
  | { ok: true; units: number; costAnchor: number; markedValueAnchor: number; bondId: ObjectId }
  | { ok: false; reason: string };

function resolveBondCurrency(bond: Bond): CurrencyCode {
  return (bond.currencyCode ??
    (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : "USD")) as CurrencyCode;
}

async function atomicallyDebitFundCashAnchor(
  db: Db,
  fundId: ObjectId,
  amountAnchor: number,
  minimumRemainingCashAnchor = 0
): Promise<{ ok: true; newCashAnchor: number } | { ok: false }> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return { ok: false };
  const rounded = Math.round(amountAnchor * 100) / 100;
  const result = await db
    .collection<IndexFund>("indexFunds")
    .findOneAndUpdate(
      { _id: fundId, cashAnchor: { $gte: rounded + minimumRemainingCashAnchor } },
      { $inc: { cashAnchor: -rounded }, $set: { updatedAt: new Date() } },
      { returnDocument: "after", projection: { cashAnchor: 1 } }
    );
  if (!result) return { ok: false };
  return { ok: true, newCashAnchor: result.cashAnchor };
}

async function refundFundCashAnchor(db: Db, fundId: ObjectId, amountAnchor: number): Promise<void> {
  if (!Number.isFinite(amountAnchor) || amountAnchor <= 0) return;
  const rounded = Math.round(amountAnchor * 100) / 100;
  await db
    .collection("indexFunds")
    .updateOne({ _id: fundId }, { $inc: { cashAnchor: rounded }, $set: { updatedAt: new Date() } });
}

type BondPurchaseFund = Pick<IndexFund, "_id" | "name" | "quotedNav" | "anchorCurrencyCode">;

export interface BondPurchaseOptions {
  /** Preloaded bond pools for a pass of many purchases; advanced as each credits its pool. */
  bondPools?: Map<CurrencyCode, BondMarketPool>;
  /** Stable FX snapshot for the reserve deployment pass. */
  fxRates?: Partial<Record<CurrencyCode, number>>;
  maxCostAnchor?: number;
  cashFloor?: { cashAnchor: number; totalBackingAnchor: number; fraction: number };
  /** Caller must flush completed purchase receipts even if a later purchase fails. */
  txSink?: Omit<IndexFundTransaction, "_id">[];
  /** Caller flushes ledger rows for completed purchases after the reserve pass. */
  ledgerSink?: TxInput[];
  /**
   * #992 tranche 6: game turn stamped on the fund-subject ledger row. When
   * absent no ledger row is emitted (the cash debit still settles) so
   * turn-less callers keep their old behavior.
   */
  turn?: number;
  /** Preloaded thresholds for the ledger row; avoids a per-purchase read. */
  thresholds?: TxThresholds;
  /** Preloaded turn cadence for the transaction expiry date. */
  turnLengthMinutes?: number;
}

/** A sized and priced purchase, not yet settled. */
export interface BondPurchasePlan {
  bond: Bond;
  currency: CurrencyCode;
  units: number;
  pricePerUnit: number;
  costLocal: number;
  costAnchor: number;
  markedValueAnchor: number;
  /** Cash the fund must still hold after the debit (reserve cash buffer). */
  minimumCash: number;
}

export type PlanBondPurchaseResult =
  { ok: true; plan: BondPurchasePlan } | { ok: false; reason: string };

/**
 * Size and price a fund bond purchase: float, position cap, ask quote,
 * budget and cash-buffer checks. Reads nothing when `bondPools` and `fxRates`
 * are supplied. Shared by the per-purchase path and the batched settlement so
 * both buy exactly the same units at the same price.
 */
export async function planBondUnitsForFund(
  db: Db,
  fund: BondPurchaseFund,
  bond: Bond,
  units: number,
  options?: BondPurchaseOptions
): Promise<PlanBondPurchaseResult> {
  const wholeUnits = Math.floor(units);
  if (wholeUnits <= 0) return { ok: false, reason: "invalid_units" };
  if (bond.matured || bond.defaulted) return { ok: false, reason: "bond_unavailable" };
  if ((bond.publicFloat ?? 0) < wholeUnits) return { ok: false, reason: "insufficient_float" };
  if (sovereignBondCapError(bond, "fundId", fund._id, wholeUnits)) {
    return { ok: false, reason: "position_limit" };
  }

  const bondCurrency = resolveBondCurrency(bond);
  const fxRates = options?.fxRates ?? (await loadFxRatesRecord(db));
  const bondFxRate =
    fxRates[bondCurrency] && fxRates[bondCurrency]! > 0 ? fxRates[bondCurrency]! : 1;
  const quote = await loadBondQuote(db, bond, { pools: options?.bondPools });
  const costForUnits = (count: number) =>
    Math.round(corpCapitalToAnchor(count * quote.askPerUnit, bondCurrency, bondFxRate) * 100) / 100;
  const markedForUnits = (count: number) =>
    corpCapitalToAnchor(count * BOND_UNIT_FACE_VALUE * bond.marketPrice, bondCurrency, bondFxRate);
  const affordable = (count: number) => {
    const cost = costForUnits(count);
    if (cost <= 0 || cost > (options?.maxCostAnchor ?? Infinity) + 1e-9) return false;
    const floor = options?.cashFloor;
    return (
      !floor ||
      floor.cashAnchor - cost + 1e-9 >=
        floor.fraction * (floor.totalBackingAnchor + markedForUnits(count) - cost)
    );
  };
  let low = 0;
  let high = wholeUnits;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (affordable(middle)) low = middle;
    else high = middle - 1;
  }
  const affordableUnits = low;
  if (affordableUnits <= 0) return { ok: false, reason: "cash_buffer_floor" };
  const costLocal = affordableUnits * quote.askPerUnit;
  const costAnchor = costForUnits(affordableUnits);
  const markedValueAnchor = markedForUnits(affordableUnits);
  if (costAnchor <= 0) return { ok: false, reason: "zero_cost" };

  const minimumCash = options?.cashFloor
    ? Math.max(
        0,
        options.cashFloor.fraction *
          (options.cashFloor.totalBackingAnchor + markedValueAnchor - costAnchor)
      )
    : 0;
  return {
    ok: true,
    plan: {
      bond,
      currency: bondCurrency,
      units: affordableUnits,
      pricePerUnit: quote.askPerUnit,
      costLocal,
      costAnchor,
      markedValueAnchor,
      minimumCash,
    },
  };
}

/**
 * Buy bond units from public float on behalf of an index fund.
 * Debits fund `cashAnchor` (anchor currency) and credits `holders.fundId`.
 */
export async function purchaseBondUnitsForFund(
  db: Db,
  fund: BondPurchaseFund,
  bond: Bond,
  units: number,
  options?: BondPurchaseOptions
): Promise<PurchaseBondUnitsForFundResult> {
  const planned = await planBondUnitsForFund(db, fund, bond, units, options);
  if (!planned.ok) return planned;
  const {
    currency: bondCurrency,
    units: affordableUnits,
    pricePerUnit,
    costLocal,
    costAnchor,
    markedValueAnchor,
    minimumCash,
  } = planned.plan;

  const debit = await atomicallyDebitFundCashAnchor(db, fund._id, costAnchor, minimumCash);
  if (!debit.ok) return { ok: false, reason: "insufficient_fund_cash" };

  const now = new Date();
  try {
    const reserved = await reserveBondUnitsForHolder(
      db,
      bond._id,
      { field: "fundId", id: fund._id },
      affordableUnits,
      now,
      { avgCostPerUnit: pricePerUnit }
    );
    if (!reserved) {
      await refundFundCashAnchor(db, fund._id, costAnchor);
      return { ok: false, reason: "reservation_failed" };
    }

    await creditBondPool(db, bondCurrency, costLocal, "purchasesIn", now);
    advanceBondPoolSnapshot(options?.bondPools, bondCurrency, costLocal);

    const transaction = bondPurchaseReceipt(fund, planned.plan, now);
    if (options?.txSink) options.txSink.push(transaction);
    else await insertFundTransaction(db, transaction);

    // #992 tranche 6: fund-subject ledger leg for the cashAnchor debit above.
    // The bond position is an asset account the shadow ledger does not carry,
    // so the row is single-sided under the shared bond_principal_investment
    // reason (the sale leg shares it, netting per currency). Fund-subject
    // rows never mirror, so this is the only ledger row for the debit, and it
    // fires only on the committed path — a refunded reservation emits nothing.
    if (options?.turn !== undefined) {
      const ledgerEntry = bondPurchaseLedgerEntry(fund, planned.plan, options.turn, now);
      if (options.ledgerSink) options.ledgerSink.push(ledgerEntry);
      else
        await emitTx(db, ledgerEntry, options.thresholds, {
          turnLengthMinutes: options.turnLengthMinutes,
        });
    }

    return { ok: true, units: affordableUnits, costAnchor, markedValueAnchor, bondId: bond._id };
  } catch (err) {
    await refundFundCashAnchor(db, fund._id, costAnchor);
    throw err;
  }
}

function bondPurchaseReceipt(
  fund: BondPurchaseFund,
  plan: BondPurchasePlan,
  now: Date
): Omit<IndexFundTransaction, "_id"> {
  return {
    fundId: fund._id,
    kind: "bond_allocation",
    amountAnchor: plan.costAnchor,
    navAnchor: fund.quotedNav,
    note: `Purchased ${plan.units} bond units (${plan.bond.issuerName ?? "sovereign"})`,
    createdAt: now,
  };
}

function bondPurchaseLedgerEntry(
  fund: BondPurchaseFund,
  plan: BondPurchasePlan,
  turn: number,
  now: Date
): TxInput {
  return {
    type: "bond_purchase",
    turn,
    createdAt: now,
    subjectType: "fund",
    subjectId: fund._id,
    subjectName: fund.name,
    amount: -plan.costAnchor,
    anchorAmount: -plan.costAnchor,
    currencyCode: fund.anchorCurrencyCode,
    counterpartyType: "system",
    counterpartyName: plan.bond.issuerName ?? "Bond market",
    meta: {
      bondId: plan.bond._id.toString(),
      units: plan.units,
      pricePerUnit: plan.pricePerUnit,
      source: "bond-reserve",
    },
  };
}

/**
 * Thrown inside the settlement transaction when a write's guard no longer
 * holds (cash, float or holder row moved since the plan was made). Throwing
 * aborts the transaction, so nothing from the batch is committed and the
 * caller can safely re-run the per-purchase path.
 */
export class BondBatchGuardMiss extends Error {
  constructor(what: string) {
    super(`Bond batch settlement guard missed: ${what}`);
    this.name = "BondBatchGuardMiss";
  }
}

/**
 * Settle a fund's planned bond purchases inside one transaction: the same
 * guarded fund debits, holder reservations and pool credits the per-purchase
 * path issues, in the same order per document, as three ordered bulk writes.
 * Every write must apply or the transaction aborts with {@link BondBatchGuardMiss}.
 * Receipts and ledger rows are pushed to the sinks only after this returns.
 */
export async function settleBondPurchasesInTransaction(
  db: Db,
  session: ClientSession,
  fund: BondPurchaseFund,
  purchases: { plan: BondPurchasePlan; now: Date }[]
): Promise<void> {
  if (purchases.length === 0) return;

  const debits: AnyBulkWriteOperation<IndexFund>[] = purchases.map(({ plan, now }) => {
    const rounded = Math.round(plan.costAnchor * 100) / 100;
    return {
      updateOne: {
        filter: { _id: fund._id, cashAnchor: { $gte: rounded + plan.minimumCash } },
        update: { $inc: { cashAnchor: -rounded }, $set: { updatedAt: now } },
      },
    };
  });

  const reservations: AnyBulkWriteOperation<Bond>[] = purchases.map(({ plan, now }) => {
    const holds = (plan.bond.holders ?? []).some((holder) => holder.fundId?.equals(fund._id));
    return holds
      ? {
          updateOne: {
            filter: {
              _id: plan.bond._id,
              publicFloat: { $gte: plan.units },
              "holders.fundId": fund._id,
            },
            update: {
              $inc: { "holders.$.units": plan.units, publicFloat: -plan.units },
              $set: { updatedAt: now, "holders.$.avgCostPerUnit": plan.pricePerUnit },
            },
          },
        }
      : {
          updateOne: {
            filter: {
              _id: plan.bond._id,
              publicFloat: { $gte: plan.units },
              holders: { $not: { $elemMatch: { fundId: fund._id } } },
            },
            update: {
              $push: {
                holders: { fundId: fund._id, units: plan.units, avgCostPerUnit: plan.pricePerUnit },
              },
              $inc: { publicFloat: -plan.units },
              $set: { updatedAt: now },
            },
          },
        };
  });

  const poolCredits: AnyBulkWriteOperation<BondMarketPool>[] = [];
  for (const { plan, now } of purchases) {
    const amount = Math.round(plan.costLocal * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    poolCredits.push({
      updateOne: {
        filter: { _id: plan.currency },
        update: {
          $inc: { cashLocal: amount, "lifetime.purchasesIn": amount },
          $set: { updatedAt: now },
          $setOnInsert: { targetCashLocal: 0, createdAt: now },
        },
        upsert: true,
      },
    });
  }

  const debited = await db
    .collection<IndexFund>("indexFunds")
    .bulkWrite(debits, { ordered: true, session });
  if (debited.matchedCount !== debits.length) throw new BondBatchGuardMiss("fund cash");

  const reserved = await db
    .collection<Bond>("bonds")
    .bulkWrite(reservations, { ordered: true, session });
  if (reserved.matchedCount !== reservations.length) throw new BondBatchGuardMiss("bond float");

  if (poolCredits.length > 0) {
    const credited = await db
      .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
      .bulkWrite(poolCredits, { ordered: true, session });
    if (credited.matchedCount + credited.upsertedCount !== poolCredits.length) {
      throw new BondBatchGuardMiss("bond pool");
    }
  }
}

/** Receipt and ledger row for a settled purchase, identical to the per-purchase path's. */
export function recordSettledBondPurchase(
  fund: BondPurchaseFund,
  plan: BondPurchasePlan,
  now: Date,
  options?: Pick<BondPurchaseOptions, "txSink" | "ledgerSink" | "turn">
): void {
  options?.txSink?.push(bondPurchaseReceipt(fund, plan, now));
  if (options?.turn !== undefined) {
    options.ledgerSink?.push(bondPurchaseLedgerEntry(fund, plan, options.turn, now));
  }
}
