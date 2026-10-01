/**
 * Redemption liquidity: sell fund-held shares back to issuer public float so
 * NPPs, other funds, and players can absorb them (mirror of absorption buys).
 */

import type { ClientSession, Db, ObjectId } from "mongodb";
import type {
  Corporation,
  IndexFund,
  IndexFundHolding,
  IndexFundPendingLiquiditySale,
} from "@/lib/db/types";
import { creditSharesToFund, debitSharesFromFund } from "@/lib/corporations/shareholderOps";
import {
  isOrderFlowPriceEligible,
  resolveShareExecutionPrice,
} from "@/lib/corporations/marketExecution";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  onFloatSellCommitted,
  reverseFloatSellDebit,
  settleFloatSellDebit,
} from "@/lib/corporations/shareEscrowSettlement";
import { loadEquityQuote } from "@/lib/equities/marketPool";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  shareTradeAnchorValue,
} from "@/lib/currency/corporationCapital";
import { emitTx, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type { TxThresholds } from "@/lib/db/types/financialTxLog";
import { insertFundTransaction, updateFundHoldings } from "@/lib/indexFunds/fundQueries";

export type HoldingSaleInput = {
  corporationId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
  /** Finite currency-pool bid depth available for this holding right now. */
  maxShares?: number;
};

export type HoldingSalePlan = HoldingSaleInput & {
  sharesToSell: number;
  proceedsAnchor: number;
};

/** Plan proportional share sales to raise up to `cashNeededAnchor` (round down). */
export function planProportionalHoldingsSale(
  holdings: HoldingSaleInput[],
  cashNeededAnchor: number
): HoldingSalePlan[] {
  if (!Number.isFinite(cashNeededAnchor) || cashNeededAnchor <= 0) return [];

  const eligible = holdings.filter(
    (h) => h.shares > 0 && Number.isFinite(h.pricePerShareAnchor) && h.pricePerShareAnchor > 0
  );
  if (eligible.length === 0) return [];

  const sellableShares = (h: HoldingSaleInput) =>
    Math.max(0, Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER));
  const totalValue = eligible.reduce(
    (sum, h) => sum + sellableShares(h) * h.pricePerShareAnchor,
    0
  );
  if (totalValue <= 0) return [];

  if (cashNeededAnchor >= totalValue) {
    return eligible.map((h) => ({
      ...h,
      sharesToSell: sellableShares(h),
      proceedsAnchor: sellableShares(h) * h.pricePerShareAnchor,
    }));
  }

  const plans: HoldingSalePlan[] = [];
  let remainingCash = cashNeededAnchor;

  const targets = eligible.map((h) => ({
    ...h,
    holdingValue: sellableShares(h) * h.pricePerShareAnchor,
    targetProceeds: (cashNeededAnchor * sellableShares(h) * h.pricePerShareAnchor) / totalValue,
  }));

  const soldByCorp = new Map<string, number>();

  for (const target of targets) {
    const sharesToSell = Math.min(
      sellableShares(target),
      Math.floor(target.targetProceeds / target.pricePerShareAnchor)
    );
    if (sharesToSell <= 0) continue;
    const proceedsAnchor = sharesToSell * target.pricePerShareAnchor;
    plans.push({
      corporationId: target.corporationId,
      shares: target.shares,
      pricePerShareAnchor: target.pricePerShareAnchor,
      sharesToSell,
      proceedsAnchor,
    });
    soldByCorp.set(target.corporationId.toString(), sharesToSell);
    remainingCash -= proceedsAnchor;
  }

  // Assign remainder one share at a time (largest holdings first).
  const byValue = [...eligible].sort(
    (a, b) => sellableShares(b) * b.pricePerShareAnchor - sellableShares(a) * a.pricePerShareAnchor
  );

  while (remainingCash > 0) {
    let assigned = false;
    for (const holding of byValue) {
      const key = holding.corporationId.toString();
      const alreadySold = soldByCorp.get(key) ?? 0;
      const remainingShares = sellableShares(holding) - alreadySold;
      if (remainingShares <= 0) continue;
      if (holding.pricePerShareAnchor > remainingCash + 1e-9) continue;

      const existing = plans.find((p) => p.corporationId.toString() === key);
      if (existing) {
        existing.sharesToSell += 1;
        existing.proceedsAnchor += holding.pricePerShareAnchor;
        soldByCorp.set(key, existing.sharesToSell);
      } else {
        plans.push({
          corporationId: holding.corporationId,
          shares: holding.shares,
          pricePerShareAnchor: holding.pricePerShareAnchor,
          sharesToSell: 1,
          proceedsAnchor: holding.pricePerShareAnchor,
        });
        soldByCorp.set(key, 1);
      }
      remainingCash -= holding.pricePerShareAnchor;
      assigned = true;
      break;
    }
    if (!assigned) break;
  }

  return plans.filter((p) => p.sharesToSell > 0);
}

export function updateHoldingAfterSale(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  sharesSold: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  return holdings
    .map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares - sharesSold;
      if (newShares <= 0) return null;
      return {
        ...h,
        shares: newShares,
        lastValueAnchor: newShares * sharePriceAnchor,
      };
    })
    .filter((h): h is IndexFundHolding => h !== null);
}

export type SellHoldingsForRedemptionResult = {
  cashRaisedAnchor: number;
  sharesSold: number;
  salesExecuted: number;
  /** Standalone-only economic reversal for completed sales, in reverse order. */
  undo?: () => Promise<void>;
  /**
   * True when liquidity raising was refused because a previous sale's crash
   * journal is still pending (#2223, fail-closed). No sale was attempted and
   * no money moved: reconcile `pendingLiquiditySale` manually, clear it, and
   * the next pass raises again. Callers keep paying redemptions from cash.
   */
  liquidityQuarantined?: boolean;
};

/**
 * Thrown when a standalone sale cannot start because a previous sale's crash
 * journal is still pending. Carries no money movement: the sale never began.
 * Caught at the `sellFundHolding*` boundary and reported as
 * `liquidityQuarantined`, never compensated (there is nothing to reverse).
 */
export class LiquiditySaleQuarantinedError extends Error {
  constructor(readonly saleId: string) {
    super(
      `Redemption-liquidity sale ${saleId} refused: a previous sale's crash journal is still pending (fail-closed)`
    );
    this.name = "LiquiditySaleQuarantinedError";
  }
}

/** Fresh projected read of the fund's sale crash journal (standalone only). */
async function readPendingLiquiditySale(
  db: Db,
  fundId: IndexFund["_id"]
): Promise<IndexFundPendingLiquiditySale | null> {
  const rows = await db
    .collection<IndexFund>("indexFunds")
    .find({ _id: fundId })
    .project({ pendingLiquiditySale: 1 })
    .toArray();
  return (rows[0] as IndexFund | undefined)?.pendingLiquiditySale ?? null;
}

function quarantinedSaleResult(
  fund: IndexFund,
  pending: IndexFundPendingLiquiditySale
): SellHoldingsForRedemptionResult {
  console.warn(
    `[indexfund-liquidity] fund ${fund.slug}: skipping liquidity sale — unreconciled interrupted sale ${pending.saleId} ` +
      `(${pending.shares} shares, started ${pending.startedAt.toISOString()}) is still journaled. ` +
      `Reconcile it manually, then clear pendingLiquiditySale on the fund to resume raising.`
  );
  return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0, liquidityQuarantined: true };
}

/**
 * Journal a standalone sale before its first value-moving leg. Set-if-absent:
 * returns false when another sale's journal is still pending, in which case
 * the caller must quarantine, never overwrite (the pending journal is the
 * only record of a possibly half-moved sale).
 */
async function journalLiquiditySaleStart(
  db: Db,
  fundId: IndexFund["_id"],
  journal: IndexFundPendingLiquiditySale
): Promise<boolean> {
  const result = await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: fundId, pendingLiquiditySale: { $exists: false } },
      { $set: { pendingLiquiditySale: journal, updatedAt: new Date() } }
    );
  return result.matchedCount === 1;
}

/**
 * Clear a sale's crash journal once the sale is economically complete (or
 * fully unwound). Never throws: a failed clear only leaves the journal in
 * place, which quarantines the next pass fail-closed — the safe direction.
 */
async function clearLiquiditySaleJournal(
  db: Db,
  fundId: IndexFund["_id"],
  saleId: string
): Promise<void> {
  try {
    await db
      .collection<IndexFund>("indexFunds")
      .updateOne(
        { _id: fundId, "pendingLiquiditySale.saleId": saleId },
        { $unset: { pendingLiquiditySale: "" }, $set: { updatedAt: new Date() } }
      );
  } catch (error) {
    console.error(
      `[indexfund-liquidity] fund ${fundId.toString()}: failed to clear sale journal ${saleId} after an economically complete sale; ` +
        `liquidity raising stays quarantined until manual clear:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Manual reconciliation clear for a quarantined liquidity journal (#2223).
 * Call ONLY after a human has reconciled the journaled sale against the
 * issuer, the cap table, fund cash, and fund holdings: the journal is the
 * sole record of a possibly half-moved sale, and clearing it re-enables
 * liquidity raising for the fund. Conditional (clears only when a journal is
 * present); returns true when a journal was cleared.
 *
 * Supported-configuration safety decision for redemption-liquidity sales:
 * - Replica set: sales run inside the caller's transaction and the abort
 *   owns recovery (no journal, fully automatic). This is the supported
 *   production configuration.
 * - Standalone with caught errors: each leg is individually guarded and a
 *   failed sale is automatically compensated in reverse order (fully
 *   unwound sales clear their own journal). Automatic.
 * - Standalone process death mid-sale: the legs span too many documents for
 *   single-document marker atomicity, so the sale is NOT replayed or
 *   auto-reversed. The surviving journal quarantines this fund's liquidity
 *   raising fail-closed (redemptions still pay from available cash) until a
 *   human reconciles the journaled figures and calls this clear. Durable
 *   quarantine is the accepted safety posture here: a half-moved sale
 *   replayed blind could double-sell shares or double-credit cash, while a
 *   quarantined fund merely defers raising (holders are still paid from
 *   cash, pro-rata). The quarantine is sticky and terminal until this
 *   clear runs. It never self-heals, so an unreconciled sale cannot
 *   silently resume.
 */
export async function clearPendingLiquiditySale(
  db: Db,
  fundId: IndexFund["_id"]
): Promise<boolean> {
  const result = await db
    .collection<IndexFund>("indexFunds")
    .updateOne(
      { _id: fundId, pendingLiquiditySale: { $exists: true } },
      { $unset: { pendingLiquiditySale: "" }, $set: { updatedAt: new Date() } }
    );
  return result.matchedCount === 1;
}

type CorpQuoteRow = Pick<
  Corporation,
  | "_id"
  | "name"
  | "sharePrice"
  | "fundamentalSharePrice"
  | "publicFloat"
  | "totalShares"
  | "liquidCurrencyCode"
  | "countryId"
  | "shareBuybackMode"
>;

/**
 * Sell fund holdings into public float until `cashNeededAnchor` is raised or
 * sales are exhausted (issuer treasury may block individual corps).
 */
export async function sellFundHoldingsForRedemptionCash(
  db: Db,
  fund: IndexFund,
  cashNeededAnchor: number,
  options?: {
    session?: ClientSession;
    note?: string;
    corporationIds?: import("mongodb").ObjectId[];
  }
): Promise<SellHoldingsForRedemptionResult> {
  if (!Number.isFinite(cashNeededAnchor) || cashNeededAnchor <= 0 || fund.holdings.length === 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const filterSet = options?.corporationIds
    ? new Set(options.corporationIds.map((id) => id.toString()))
    : null;
  const holdingsToSell = filterSet
    ? fund.holdings.filter((h) => filterSet.has(h.corporationId.toString()))
    : fund.holdings;
  if (holdingsToSell.length === 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  // Fail-closed crash journal (#2223, standalone only): a surviving journal
  // means a previous sale may have died mid-leg, where the legs span too many
  // documents for marker atomicity. Raise nothing until a human reconciles
  // the journaled sale and clears it; redemptions still pay from cash.
  // Inside a transaction the abort owns recovery, so no journal applies.
  if (!options?.session) {
    const pending = await readPendingLiquiditySale(db, fund._id);
    if (pending) return quarantinedSaleResult(fund, pending);
  }

  const corpIds = holdingsToSell.map((h) => h.corporationId);
  const corps = (await db
    .collection<CorpQuoteRow>("corporations")
    .find({ _id: { $in: corpIds } })
    .project({
      _id: 1,
      name: 1,
      sharePrice: 1,
      fundamentalSharePrice: 1,
      publicFloat: 1,
      totalShares: 1,
      liquidCurrencyCode: 1,
      countryId: 1,
      shareBuybackMode: 1,
    })
    .toArray()) as CorpQuoteRow[];
  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));

  const fxByCurrency = await loadFxRatesByCurrency(db);
  const pricedHoldings: HoldingSaleInput[] = [];
  for (const holding of holdingsToSell) {
    const corp = corpMap.get(holding.corporationId.toString());
    if (!corp) continue;
    const quote = await loadEquityQuote(db, corp);
    const executionPrice = quote.bidPriceLocal;
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) continue;
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const pricePerShareAnchor = shareTradeAnchorValue(
      1,
      { ...corp, sharePrice: executionPrice },
      fxRate
    );
    if (pricePerShareAnchor <= 0) continue;
    pricedHoldings.push({
      corporationId: holding.corporationId,
      shares: holding.shares,
      pricePerShareAnchor,
      maxShares: quote.active ? quote.bidDepthShares : undefined,
    });
  }

  const plan = filterSet
    ? pricedHoldings.map((h) => ({
        ...h,
        sharesToSell: Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER),
        proceedsAnchor:
          Math.min(Math.floor(h.shares), h.maxShares ?? Number.MAX_SAFE_INTEGER) *
          h.pricePerShareAnchor,
      }))
    : planProportionalHoldingsSale(pricedHoldings, cashNeededAnchor);
  if (plan.length === 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  let holdings = [...fund.holdings];
  let cashRaisedAnchor = 0;
  let sharesSold = 0;
  let salesExecuted = 0;
  const saleUndos: Array<() => Promise<void>> = [];
  const turn = await getCurrentTurn(db);
  const now = new Date();
  // #992 tranche 6: one thresholds read for the whole sale loop; the FX map
  // above is reused per sale so neither is re-read per item.
  const thresholds = await loadTxThresholds(db);

  // A sale that refuses to start (a raced journal appeared after the entry
  // check) stops the loop fail-closed; completed sales keep their undos.
  let quarantined = false;
  for (const sale of plan) {
    if (cashRaisedAnchor >= cashNeededAnchor) break;

    const corp = corpMap.get(sale.corporationId.toString());
    if (!corp) continue;

    let saleResult: Awaited<ReturnType<typeof executeOneHoldingSale>>;
    try {
      saleResult = await executeOneHoldingSale(db, fund, corp, sale, holdings, turn, now, {
        session: options?.session,
        note: options?.note,
        thresholds,
        fxByCurrency,
      });
    } catch (error) {
      if (!(error instanceof LiquiditySaleQuarantinedError)) throw error;
      quarantined = true;
      break;
    }
    if (!saleResult) continue;

    cashRaisedAnchor += saleResult.proceedsAnchor;
    sharesSold += sale.sharesToSell;
    salesExecuted++;
    holdings = saleResult.updatedHoldings;
    if (saleResult.undo) saleUndos.push(saleResult.undo);
  }

  const result: SellHoldingsForRedemptionResult = {
    cashRaisedAnchor,
    sharesSold,
    salesExecuted,
    ...(saleUndos.length > 0 && !options?.session
      ? {
          undo: async () => {
            const errors: unknown[] = [];
            for (const revert of saleUndos.reverse()) {
              try {
                await revert();
              } catch (error) {
                errors.push(error);
              }
            }
            if (errors.length > 0) {
              throw new AggregateError(
                errors,
                "One or more redemption liquidity sales could not be reversed"
              );
            }
          },
        }
      : {}),
  };
  if (quarantined) {
    const pending = await readPendingLiquiditySale(db, fund._id).catch(() => null);
    if (pending) {
      console.warn(
        `[indexfund-liquidity] fund ${fund.slug}: stopping liquidity raising — sale journal ${pending.saleId} appeared mid-pass; ` +
          `reconcile it manually, then clear pendingLiquiditySale on the fund to resume raising.`
      );
    }
    return { ...result, liquidityQuarantined: true };
  }
  return result;
}

// ── Shared per-sale execution helper ─────────────────────────────────────────

type OneHoldingSaleOptions = {
  session?: ClientSession;
  note?: string;
  settlementCounterparty?: "market" | "issuer";
  /**
   * #992 tranche 6: preloaded one-per-pass inputs so the per-sale body does
   * no per-item reads of its own (thresholds for the ledger row, FX for the
   * proceeds conversion). Callers that loop over sales load both once.
   */
  thresholds?: TxThresholds;
  fxByCurrency?: ReadonlyMap<CurrencyCode, number>;
};

type OneHoldingSaleResult = {
  proceedsAnchor: number;
  updatedHoldings: IndexFundHolding[];
  undo?: () => Promise<void>;
};

/**
 * Execute a single holding-sale leg: settle issuer debit, debit shares from
 * fund, credit cash, update holdings, insert tx + trade history.
 * Returns null if the sale could not be executed (issuer block, insufficient
 * holdings, etc.) — the caller must skip and continue.
 */
async function executeOneHoldingSale(
  db: Db,
  fund: IndexFund,
  corp: CorpQuoteRow,
  sale: { corporationId: ObjectId; sharesToSell: number; pricePerShareAnchor: number },
  currentHoldings: IndexFundHolding[],
  turn: number,
  now: Date,
  options?: OneHoldingSaleOptions
): Promise<OneHoldingSaleResult | null> {
  const quote = await loadEquityQuote(db, corp);
  const issuerFunded = options?.settlementCounterparty === "issuer";
  if (!issuerFunded && quote.active && sale.sharesToSell > quote.bidDepthShares) return null;
  const executionPrice = issuerFunded ? resolveShareExecutionPrice(corp) : quote.bidPriceLocal;
  const orderFlowEligible = isOrderFlowPriceEligible(corp.publicFloat, corp.totalShares);
  const issuerBuyback = sale.sharesToSell * executionPrice;

  const standalone = !options?.session;
  const fxByCurrency = options?.fxByCurrency ?? (await loadFxRatesByCurrency(db));
  const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
  const proceedsAnchor =
    Math.round(
      shareTradeAnchorValue(sale.sharesToSell, { ...corp, sharePrice: executionPrice }, fxRate) *
        100
    ) / 100;

  const updatedHoldings = updateHoldingAfterSale(
    currentHoldings,
    sale.corporationId,
    sale.sharesToSell,
    sale.pricePerShareAnchor
  );

  // Standalone crash journal (#2223): set before the first value-moving leg
  // so a process death mid-sale is detectable. The legs below span the
  // issuer, the cap table, fund cash, and fund holdings — too many documents
  // for single-document marker atomicity — so an interrupted sale is NOT
  // replayed or auto-reversed: the next pass quarantines this fund's
  // liquidity raising until a human reconciles the journaled sale (fail-
  // closed). Inside a transaction the abort owns recovery, so no journal.
  // Supported configurations: replica set = fully automatic recovery via
  // abort; standalone caught errors = automatic compensation below;
  // standalone process death = journal + quarantine + manual clear.
  const saleId = `ls-${fund._id.toString()}-${sale.corporationId.toString()}-${now.getTime()}-${sale.sharesToSell}`;
  const saleJournal: IndexFundPendingLiquiditySale = {
    saleId,
    corporationId: sale.corporationId,
    shares: sale.sharesToSell,
    proceedsAnchor,
    startedAt: now,
  };
  if (standalone) {
    const journaled = await journalLiquiditySaleStart(db, fund._id, saleJournal);
    if (!journaled) throw new LiquiditySaleQuarantinedError(saleId);
  }

  const issuerDebit = await settleFloatSellDebit(db, corp, issuerBuyback, {
    session: options?.session,
    counterparty: options?.settlementCounterparty,
  });
  if (!issuerDebit.ok) {
    if (standalone) await clearLiquiditySaleJournal(db, fund._id, saleId);
    return null;
  }

  const remaining = await debitSharesFromFund(
    db,
    corp._id,
    fund._id,
    sale.sharesToSell,
    {
      $inc: {
        publicFloat: sale.sharesToSell,
        ...(orderFlowEligible
          ? { orderFlowWindowSellValue: sale.sharesToSell * executionPrice }
          : {}),
      },
      $set: { updatedAt: now },
    },
    { requireSufficient: true, session: options?.session }
  );

  if (remaining < 0) {
    await reverseFloatSellDebit(db, corp, issuerBuyback, {
      session: options?.session,
      split: issuerDebit.split,
      counterparty: options?.settlementCounterparty,
    });
    if (standalone) await clearLiquiditySaleJournal(db, fund._id, saleId);
    return null;
  }

  // Every leg below runs after value already moved (issuer debit + share
  // debit are committed). On a replica set the caller aborts the enclosing
  // transaction, so just rethrow; on standalone there is no transaction, so
  // reverse the completed legs here in reverse order. Without this a crash
  // between the share debit and the cash credit destroys value (issuer paid,
  // fund credited nothing), and a crash between the cash credit and the
  // holdings write double-counts (fund holds both the cash and the shares).
  // This compensation only covers caught exceptions: a process death past
  // this point leaves the journal above pending, which quarantines the next
  // pass fail-closed.
  let cashCredited = false;
  let holdingsWritten = false;
  let transactionId: ObjectId | undefined;
  try {
    const cashResult = await db
      .collection("indexFunds")
      .updateOne(
        { _id: fund._id },
        { $inc: { cashAnchor: proceedsAnchor }, $set: { updatedAt: now } },
        options?.session ? { session: options.session } : undefined
      );
    if (cashResult.matchedCount !== 1) {
      throw new Error("Fund disappeared during redemption-liquidity sale");
    }
    cashCredited = true;

    await updateFundHoldings(db, fund._id, updatedHoldings, { session: options?.session });
    holdingsWritten = true;

    // Economic commit point: shares are gone and cash is credited. Clear the
    // crash journal before the evidence rows, so a death past here leaves a
    // complete sale with at most missing audit rows (accepted), while a death
    // before here leaves the journal pending (quarantine, fail-closed).
    if (standalone) await clearLiquiditySaleJournal(db, fund._id, saleId);

    transactionId = await insertFundTransaction(
      db,
      {
        fundId: fund._id,
        kind: "public_float_sell",
        corporationId: sale.corporationId,
        shares: sale.sharesToSell,
        navAnchor: sale.pricePerShareAnchor,
        amountAnchor: proceedsAnchor,
        note: options?.note ?? "Redemption liquidity",
        createdAt: now,
      },
      { session: options?.session }
    );
  } catch (error) {
    if (!standalone) throw error;
    const compensationErrors: unknown[] = [];
    const compensate = async (revert: () => Promise<unknown>) => {
      try {
        await revert();
      } catch (compensationError) {
        compensationErrors.push(compensationError);
      }
    };
    if (transactionId !== undefined) {
      const txId = transactionId;
      await compensate(() => db.collection("indexFundTransactions").deleteOne({ _id: txId }));
    }
    if (holdingsWritten) {
      await compensate(() => updateFundHoldings(db, fund._id, currentHoldings));
    }
    if (cashCredited) {
      await compensate(() =>
        db
          .collection("indexFunds")
          .updateOne(
            { _id: fund._id },
            { $inc: { cashAnchor: -proceedsAnchor }, $set: { updatedAt: new Date() } }
          )
      );
    }
    await compensate(async () => {
      const restored = await creditSharesToFund(
        db,
        corp._id,
        fund._id,
        sale.sharesToSell,
        sale.pricePerShareAnchor,
        {
          $inc: {
            publicFloat: -sale.sharesToSell,
            ...(orderFlowEligible
              ? { orderFlowWindowSellValue: -sale.sharesToSell * executionPrice }
              : {}),
          },
          $set: { updatedAt: new Date() },
        }
      );
      if (!restored) throw new Error("Failed to restore fund shares after liquidity sale");
    });
    await compensate(() =>
      reverseFloatSellDebit(db, corp, issuerBuyback, {
        split: issuerDebit.split,
        counterparty: options?.settlementCounterparty,
      })
    );
    if (compensationErrors.length > 0) {
      // Incomplete compensation: the journal stays pending, so the next pass
      // quarantines this fund fail-closed instead of building on half-moved legs.
      throw new AggregateError(
        [error, ...compensationErrors],
        "Redemption liquidity sale failed and compensation was incomplete"
      );
    }
    // Fully unwound: nothing is outstanding, so the journal can go. A failed
    // clear only quarantines the next pass, which is the safe direction.
    await clearLiquiditySaleJournal(db, fund._id, saleId);
    throw error;
  }

  // #992 tranche 6: fund-subject ledger leg for the cashAnchor credit above.
  // The contra is the unmodeled public float (single-sided under the shared
  // equity_transfer reason, same as the tranche-5 float-buy row and the
  // character/corporation stock_trade_sell rows). Fund-subject rows never
  // mirror, so this is the only ledger row for the credit. Emitted after the
  // holdings write and the fund transaction both landed, inside the same
  // guarded sale that returns null on any settlement failure — a skipped sale
  // emits nothing, an executed sale emits exactly one row.
  await emitTx(
    db,
    {
      type: "stock_trade_sell",
      turn,
      createdAt: now,
      subjectType: "fund",
      subjectId: fund._id,
      subjectName: fund.name,
      amount: proceedsAnchor,
      anchorAmount: proceedsAnchor,
      currencyCode: fund.anchorCurrencyCode,
      counterpartyType: "system",
      counterpartyName: "Public float",
      meta: {
        corporationId: corp._id.toString(),
        shares: sale.sharesToSell,
        pricePerShareAnchor: sale.pricePerShareAnchor,
        source: options?.note ?? "redemption-liquidity",
      },
    },
    options?.thresholds
  );

  void recordShareTrade(db, {
    corporationId: corp._id,
    kind: "market_sell",
    turn,
    shares: sale.sharesToSell,
    pricePerShareAnchor: proceedsAnchor / sale.sharesToSell,
    from: { name: `${fund.name} (index fund)` },
    to: null,
    corpCurrencyCode: resolveCorpLiquidCurrencyCode(corp) ?? undefined,
    note: options?.note ?? "Index fund redemption liquidity",
  });

  await onFloatSellCommitted(db, corp, issuerBuyback, {
    session: options?.session,
    counterparty: options?.settlementCounterparty,
  });

  const committedTransactionId = transactionId;
  const undo = options?.session
    ? undefined
    : async () => {
        const errors: unknown[] = [];
        const reverse = async (work: () => Promise<unknown>) => {
          try {
            await work();
          } catch (error) {
            errors.push(error);
          }
        };
        await reverse(() =>
          db.collection("indexFundTransactions").deleteOne({ _id: committedTransactionId })
        );
        await reverse(() => updateFundHoldings(db, fund._id, currentHoldings));
        await reverse(() =>
          db
            .collection("indexFunds")
            .updateOne(
              { _id: fund._id },
              { $inc: { cashAnchor: -proceedsAnchor }, $set: { updatedAt: new Date() } }
            )
        );
        await reverse(async () => {
          const restored = await creditSharesToFund(
            db,
            corp._id,
            fund._id,
            sale.sharesToSell,
            sale.pricePerShareAnchor,
            {
              $inc: {
                publicFloat: -sale.sharesToSell,
                ...(orderFlowEligible
                  ? { orderFlowWindowSellValue: -sale.sharesToSell * executionPrice }
                  : {}),
              },
              $set: { updatedAt: new Date() },
            }
          );
          if (!restored) throw new Error("Failed to restore fund shares after liquidity sale");
        });
        await reverse(() =>
          reverseFloatSellDebit(db, corp, issuerBuyback, {
            split: issuerDebit.split,
            counterparty: options?.settlementCounterparty,
          })
        );
        if (errors.length > 0) {
          throw new AggregateError(errors, "Redemption liquidity sale compensation was incomplete");
        }
      };

  return { proceedsAnchor, updatedHoldings, undo };
}

// ── sellFundHoldingShares ─────────────────────────────────────────────────────

/**
 * Sell exactly `min(maxShares, held)` shares of ONE corporation back to the
 * public float. Uses the same issuer-settlement body as
 * `sellFundHoldingsForRedemptionCash` via the shared `executeOneHoldingSale`
 * helper, so behaviour is identical — only the share cap differs.
 */
export async function sellFundHoldingShares(
  db: Db,
  fund: IndexFund,
  corporationId: ObjectId,
  maxShares: number,
  options?: {
    session?: ClientSession;
    note?: string;
    settlementCounterparty?: "market" | "issuer";
    thresholds?: TxThresholds;
    fxByCurrency?: ReadonlyMap<CurrencyCode, number>;
    turn?: number;
  }
): Promise<SellHoldingsForRedemptionResult> {
  const holding = fund.holdings.find(
    (h) => h.corporationId.toString() === corporationId.toString()
  );
  if (!holding || holding.shares <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const corps = (await db
    .collection<CorpQuoteRow>("corporations")
    .find({ _id: corporationId })
    .project({
      _id: 1,
      name: 1,
      sharePrice: 1,
      fundamentalSharePrice: 1,
      publicFloat: 1,
      totalShares: 1,
      liquidCurrencyCode: 1,
      countryId: 1,
      shareBuybackMode: 1,
    })
    .toArray()) as CorpQuoteRow[];

  const corp = corps[0];
  if (!corp) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const quote = await loadEquityQuote(db, corp);
  const issuerFunded = options?.settlementCounterparty === "issuer";
  const sharesToSell = Math.min(
    maxShares,
    Math.floor(holding.shares),
    issuerFunded || !quote.active ? Number.MAX_SAFE_INTEGER : quote.bidDepthShares
  );
  if (sharesToSell <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const executionPrice = issuerFunded ? resolveShareExecutionPrice(corp) : quote.bidPriceLocal;
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const fxByCurrency = options?.fxByCurrency ?? (await loadFxRatesByCurrency(db));
  const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
  const pricePerShareAnchor = shareTradeAnchorValue(
    1,
    { ...corp, sharePrice: executionPrice },
    fxRate
  );
  if (pricePerShareAnchor <= 0) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  const turn = options?.turn ?? (await getCurrentTurn(db));
  const now = new Date();

  // Same fail-closed journal as the multi-sale path (standalone only).
  if (!options?.session) {
    const pending = await readPendingLiquiditySale(db, fund._id);
    if (pending) return quarantinedSaleResult(fund, pending);
  }

  let saleResult: Awaited<ReturnType<typeof executeOneHoldingSale>>;
  try {
    saleResult = await executeOneHoldingSale(
      db,
      fund,
      corp,
      { corporationId, sharesToSell, pricePerShareAnchor },
      [...fund.holdings],
      turn,
      now,
      { ...options, thresholds: options?.thresholds ?? (await loadTxThresholds(db)), fxByCurrency }
    );
  } catch (error) {
    if (!(error instanceof LiquiditySaleQuarantinedError)) throw error;
    const pending = await readPendingLiquiditySale(db, fund._id).catch(() => null);
    if (pending) return quarantinedSaleResult(fund, pending);
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0, liquidityQuarantined: true };
  }

  if (!saleResult) {
    return { cashRaisedAnchor: 0, sharesSold: 0, salesExecuted: 0 };
  }

  return {
    cashRaisedAnchor: saleResult.proceedsAnchor,
    sharesSold: sharesToSell,
    salesExecuted: 1,
  };
}
