import type { Db, ObjectId } from "mongodb";
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

/**
 * Buy bond units from public float on behalf of an index fund.
 * Debits fund `cashAnchor` (anchor currency) and credits `holders.fundId`.
 */
export async function purchaseBondUnitsForFund(
  db: Db,
  fund: Pick<IndexFund, "_id" | "name" | "quotedNav" | "anchorCurrencyCode">,
  bond: Bond,
  units: number,
  options?: {
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
): Promise<PurchaseBondUnitsForFundResult> {
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
  const debit = await atomicallyDebitFundCashAnchor(db, fund._id, costAnchor, minimumCash);
  if (!debit.ok) return { ok: false, reason: "insufficient_fund_cash" };

  const now = new Date();
  const pricePerUnit = quote.askPerUnit;
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

    const transaction: Omit<IndexFundTransaction, "_id"> = {
      fundId: fund._id,
      kind: "bond_allocation",
      amountAnchor: costAnchor,
      navAnchor: fund.quotedNav,
      note: `Purchased ${affordableUnits} bond units (${bond.issuerName ?? "sovereign"})`,
      createdAt: now,
    };
    if (options?.txSink) options.txSink.push(transaction);
    else await insertFundTransaction(db, transaction);

    // #992 tranche 6: fund-subject ledger leg for the cashAnchor debit above.
    // The bond position is an asset account the shadow ledger does not carry,
    // so the row is single-sided under the shared bond_principal_investment
    // reason (the sale leg shares it, netting per currency). Fund-subject
    // rows never mirror, so this is the only ledger row for the debit, and it
    // fires only on the committed path — a refunded reservation emits nothing.
    if (options?.turn !== undefined) {
      const ledgerEntry: TxInput = {
        type: "bond_purchase",
        turn: options.turn,
        createdAt: now,
        subjectType: "fund",
        subjectId: fund._id,
        subjectName: fund.name,
        amount: -costAnchor,
        anchorAmount: -costAnchor,
        currencyCode: fund.anchorCurrencyCode,
        counterpartyType: "system",
        counterpartyName: bond.issuerName ?? "Bond market",
        meta: {
          bondId: bond._id.toString(),
          units: affordableUnits,
          pricePerUnit,
          source: "bond-reserve",
        },
      };
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
