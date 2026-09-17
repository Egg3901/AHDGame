/**
 * Sell an index fund's bond holdings to the market pool for cash, one keyed
 * sub-flow per bond sold (issue #1672).
 *
 * Used when a fund owes redemptions it cannot pay from cash. Each holding is
 * sold at the pool's bid, largest position first, only as far as the pool can
 * pay (gated debit). Units go back to the pool (`publicFloat`), cash lands on
 * the fund in anchor terms. Nothing is minted: a pool with no cash buys
 * nothing and the redemption waits.
 *
 * Crash-safety shape: every executed sale is its own idempotent flow keyed
 * `bond-fund-sell:<parent>:<bond>:<units>:<proceedsLocal>`, so a retry (or
 * the next cron pass) plans the remainder from current holdings and never
 * re-executes a completed sale under a new key. A crash INSIDE one sale
 * reconciles on same-key retry as long as the recomputed plan matches; when
 * the plan drifts (holdings changed mid-sale) the `in_progress` receipt stays
 * TTL-visible for ops instead of double-applying.
 *
 * Step order per sale is release-first (holder release, pool debit, fund
 * credit, transaction row), which differs from the legacy debit-first order
 * on purpose: a crash between the release and the pool debit moves no money
 * at all (units merely sit in the float until a later sale), halving the
 * money-strand window. Success and skip outcomes are identical to the legacy
 * order; only the crash windows differ.
 */

import { randomUUID } from "node:crypto";
import type { ClientSession, Db, UpdateFilter } from "mongodb";
import type { Bond, IndexFund, IndexFundTransaction } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, loadFxRatesRecord } from "@/lib/currency/corporationCapital";
import {
  advanceBondPoolSnapshot,
  bondPoolCurrency,
  loadBondPoolsByCurrency,
  loadBondQuote,
  makeBondPoolDebitStep,
} from "@/lib/bonds/marketPool";
import { FUND_TRANSACTION_COLLECTION } from "@/lib/indexFunds/fundQueries";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";

export interface SellFundBondsResult {
  proceedsAnchor: number;
  unitsSold: number;
  bondsTouched: number;
}

/** Holder release failed: the position raced away. Skip (nothing applied). */
export const BOND_FUND_SELL_RELEASE = "BOND_FUND_SELL_RELEASE";
/** Pool debit failed: the pool cannot pay. Skip (release compensated). */
export const BOND_FUND_SELL_POOL = "BOND_FUND_SELL_POOL";
/** Fund credit failed: the fund row is gone. Abort (prefix compensated). */
export const BOND_FUND_SELL_CREDIT = "BOND_FUND_SELL_CREDIT";
/** Fund-transaction insert failed after money moved. Abort (compensated). */
export const BOND_FUND_SELL_TX = "BOND_FUND_SELL_TX";

function fxFor(rates: Record<string, number>, currency: CurrencyCode): number {
  const rate = rates[currency];
  return Number.isFinite(rate) && rate! > 0 ? rate! : 1;
}

function mapSellError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  if (step.name === "holder-release") return new Error(`${BOND_FUND_SELL_RELEASE}:${outcome}`);
  if (step.name === "pool-debit") return new Error(`${BOND_FUND_SELL_POOL}:${outcome}`);
  if (step.name === "fund-credit") return new Error(`${BOND_FUND_SELL_CREDIT}:${outcome}`);
  return new Error(`${BOND_FUND_SELL_TX}:${outcome}`);
}

function isSkipError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith(BOND_FUND_SELL_RELEASE) || message.startsWith(BOND_FUND_SELL_POOL);
}

export async function sellFundBondHoldingsForCash(
  db: Db,
  fund: Pick<IndexFund, "_id" | "name" | "quotedNav" | "anchorCurrencyCode">,
  neededAnchor: number,
  now: Date = new Date(),
  options?: { idempotencyKey?: string }
): Promise<SellFundBondsResult> {
  const result: SellFundBondsResult = { proceedsAnchor: 0, unitsSold: 0, bondsTouched: 0 };
  if (!(neededAnchor > 0)) return result;

  const parentKey = options?.idempotencyKey !== undefined ? options.idempotencyKey : randomUUID();
  if (parentKey.length === 0 || parentKey.length > 128) {
    throw new RangeError("Bond fund sale idempotency key must be 1-128 characters");
  }

  const bonds = await db
    .collection<Bond>("bonds")
    .find({
      matured: false,
      defaulted: { $ne: true },
      holders: { $elemMatch: { fundId: fund._id } },
    })
    .toArray();
  if (bonds.length === 0) return result;

  const fxRates = await loadFxRatesRecord(db);
  // One pool read for the whole pass; each executed sale advances the
  // snapshot so later quotes see the same cash skew a per-bond live read
  // would (mirrors the purchase pass).
  const bondPools = await loadBondPoolsByCurrency(db);
  const positions = bonds
    .map((bond) => ({
      bond,
      units: bond.holders.find((h) => h.fundId?.toString() === fund._id.toString())?.units ?? 0,
    }))
    .filter((row) => row.units > 0)
    .sort((a, b) => b.units * b.bond.marketPrice - a.units * a.bond.marketPrice);

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const funds = db.collection<IndexFund>("indexFunds");
  const txs = db.collection<IndexFundTransaction>(FUND_TRANSACTION_COLLECTION);
  const bondDocs = db.collection<Bond>("bonds");

  let remainingAnchor = neededAnchor;

  const runPass = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    // Zero-unit holder cleanup is not a money write: best effort, so a
    // cleanup failure can never fail a sale whose money already moved.
    const sweepZeroHolder = async (bondId: Bond["_id"]): Promise<void> => {
      try {
        await bondDocs.updateOne({ _id: bondId }, {
          $pull: { holders: { fundId: fund._id, units: { $lte: 0 } } },
        } as unknown as UpdateFilter<Bond>);
      } catch {
        // Best effort: lingering zero-unit rows match no claim guard.
      }
    };
    for (const { bond, units: held } of positions) {
      if (remainingAnchor <= 0) break;
      const currency = bondPoolCurrency(bond);
      const rate = fxFor(fxRates, currency);
      const quote = await loadBondQuote(db, bond, { pools: bondPools });
      if (!(quote.bidPerUnit > 0)) continue;
      const neededLocal = remainingAnchor * rate;
      const wantUnits = Math.min(held, Math.ceil(neededLocal / quote.bidPerUnit));
      const units = Math.min(wantUnits, quote.depthUnitsAtBid);
      if (units <= 0) continue;
      const proceedsLocal = Math.round(units * quote.bidPerUnit * 100) / 100;
      const proceedsAnchor =
        Math.round(corpCapitalToAnchor(proceedsLocal, currency, rate) * 100) / 100;

      const subKey = `${parentKey}:bond:${bond._id.toHexString()}:${units}:${proceedsLocal}`;
      const fingerprint =
        `bond-fund-sell:${fund._id.toHexString()}:${bond._id.toHexString()}` +
        `:${units}:${proceedsLocal}:${proceedsAnchor}`;
      const claim = await claimMoneyFlowReceipt(receipts, subKey, fingerprint, opts);
      if (claim === "duplicate") {
        // Already sold under this key: account it without moving money.
        await sweepZeroHolder(bond._id);
        remainingAnchor -= proceedsAnchor;
        result.proceedsAnchor += proceedsAnchor;
        result.unitsSold += units;
        result.bondsTouched++;
        continue;
      }

      const releaseStep: MoneyFlowStep = {
        name: "holder-release",
        apply: (stepOpts) =>
          applyKeyedUpdate(
            subKey,
            {
              collection: bondDocs,
              filter: {
                _id: bond._id,
                holders: { $elemMatch: { fundId: fund._id, units: { $gte: units } } },
              },
              update: {
                $inc: { "holders.$.units": -units, publicFloat: units },
                $set: { updatedAt: now },
              },
            },
            stepOpts ?? {}
          ),
        revert: (stepOpts) =>
          applyKeyedUpdate(
            `${subKey}:compensate:holder-release`,
            {
              collection: bondDocs,
              filter: {
                _id: bond._id,
                holders: { $elemMatch: { fundId: fund._id } },
              },
              update: {
                $inc: { "holders.$.units": units, publicFloat: -units },
                $set: { updatedAt: now },
              },
            },
            stepOpts ?? {}
          ),
      };

      try {
        await runMoneyFlowSteps(
          receipts,
          subKey,
          [
            releaseStep,
            makeBondPoolDebitStep(subKey, db, currency, proceedsLocal, "salesOut", now),
            makeLegStep(subKey, {
              name: "fund-credit",
              collection: funds,
              docId: fund._id,
              field: "cashAnchor",
              delta: proceedsAnchor,
              set: { updatedAt: now },
            }),
            makeInsertStep<IndexFundTransaction>("fund-tx", txs, {
              _id: keyedInsertId(subKey, "fund-bond-tx"),
              fundId: fund._id,
              kind: "bond_sale",
              amountAnchor: proceedsAnchor,
              navAnchor: fund.quotedNav,
              note: `Sold ${units} bond units (${bond.issuerName ?? "bond"}) to the market for liquidity`,
              createdAt: now,
            }),
          ],
          mapSellError,
          opts
        );
      } catch (error) {
        // A lost position race or an empty pool skips the bond, like the
        // legacy `continue` (the release-first prefix is already compensated
        // by the flow). Anything later aborts the pass after compensation,
        // like the legacy refund-and-rethrow.
        if (isSkipError(error)) continue;
        throw error;
      }

      advanceBondPoolSnapshot(bondPools, currency, -proceedsLocal);
      await sweepZeroHolder(bond._id);

      remainingAnchor -= proceedsAnchor;
      result.proceedsAnchor += proceedsAnchor;
      result.unitsSold += units;
      result.bondsTouched++;
    }
  };

  await runWithOptionalTransaction(
    async (session) => runPass(session),
    async () => runPass()
  );
  return result;
}
