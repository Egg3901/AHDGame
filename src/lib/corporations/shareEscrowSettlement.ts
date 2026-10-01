import type { ClientSession, Db, ObjectId } from "mongodb";
import type { Corporation, EquityMarketPool } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import * as Sentry from "@sentry/nextjs";
import { getShareBuybackMode } from "./shareBuybackMode";
import {
  creditCorpLiquidCapital,
  refundCorpLiquidCapital,
  atomicallyDebitCorpLiquidCapital,
  decrementCorpIssuanceProceeds,
  creditCorpShareEscrow,
  debitCorpShareEscrowFloored,
  type EscrowDebitSplit,
} from "@/lib/financialTxLog/atomicCashGuard";
import {
  creditEquityPool,
  debitEquityPoolGated,
  equityPoolCurrency,
  readEquityPool,
  refundEquityPoolDebit,
} from "@/lib/equities/marketPool";

/**
 * Centralized routing for public-float cash settlement. When a currency has an
 * equity market pool, it is the counterparty for already funded shares: buys
 * pay into the pool and sells draw from its finite cash. Primary IPO shares
 * still owned by the issuer pay the issuer first. The old issuer escrow/treasury path remains only
 * as a compatibility fallback for seed worlds and tests without a pool.
 *
 * `amountLocal` is always in the issuer's liquidCurrencyCode units
 * (= shares × executionPrice).
 */
type EscrowCorp = {
  _id: ObjectId;
  shareBuybackMode?: string;
  countryId?: string;
  liquidCurrencyCode?: string | null;
};
type EscrowSettlementOptions = {
  session?: ClientSession;
  /** Shares removed from publicFloat by this buy, for primary IPO proceeds. */
  sharesBought?: number;
  /** Explicit corporate buyouts remain issuer-funded, not ordinary market trades. */
  counterparty?: "market" | "issuer";
  /**
   * Every equity pool keyed by currency, preloaded by a caller that settles
   * many buys in one pass (the fund rebalance issues ~550). Only pool
   * EXISTENCE is decided from it; the credit itself is still an atomic $inc.
   */
  pools?: Map<CurrencyCode, EquityMarketPool>;
};

export type FloatBuyCreditReceipt = {
  issuerShares: number;
  issuerCreditLocal: number;
  poolCreditLocal: number;
};

async function claimUnpaidIpoShares(
  db: Db,
  corpId: ObjectId,
  shares: number,
  options?: EscrowSettlementOptions
): Promise<number> {
  if (!Number.isSafeInteger(shares) || shares <= 0) return 0;
  const corporations = db.collection<Corporation>("corporations");
  const mongoOptions = options?.session ? { session: options.session } : undefined;
  const previous = await corporations.findOneAndUpdate(
    {
      _id: corpId,
      "pendingShareIssuance.source": "ipo",
      "pendingShareIssuance.issuedUpfront": true,
      "pendingShareIssuance.remainingShares": { $gt: 0 },
    },
    [
      {
        $set: {
          "pendingShareIssuance.remainingShares": {
            $max: [0, { $subtract: ["$pendingShareIssuance.remainingShares", shares] }],
          },
        },
      },
    ],
    { returnDocument: "before", projection: { pendingShareIssuance: 1 }, ...mongoOptions }
  );
  return Math.min(shares, previous?.pendingShareIssuance?.remainingShares ?? 0);
}

/**
 * Credit the issuer for a float BUY.
 * - escrow mode: credit shareEscrowBalance.
 * - instant mode: credit liquidCapital AND track issuance proceeds for the
 *   reversible cash-flow audit. Escrow mode does NOT track issuance proceeds;
 *   the cash lands in the off-book escrow, which is not a share-price valuation
 *   input.
 */
export async function applyFloatBuyCredit(
  db: Db,
  corp: EscrowCorp,
  amountLocal: number,
  options?: EscrowSettlementOptions
): Promise<FloatBuyCreditReceipt> {
  const currency = equityPoolCurrency({
    countryId: corp.countryId,
    liquidCurrencyCode: corp.liquidCurrencyCode ?? undefined,
  });
  const snapshot = options?.pools?.get(currency);
  const poolExists = options?.pools
    ? snapshot !== undefined
    : Boolean(await readEquityPool(db, currency, options));
  if (options?.counterparty !== "issuer" && poolExists) {
    const issuerShares = await claimUnpaidIpoShares(
      db,
      corp._id,
      options?.sharesBought ?? 0,
      options
    );
    const issuerCreditLocal =
      issuerShares > 0 && options?.sharesBought
        ? Math.round((amountLocal * issuerShares * 100) / options.sharesBought) / 100
        : 0;
    const poolCreditLocal = Math.round((amountLocal - issuerCreditLocal) * 100) / 100;
    const mongoOptions = options?.session ? { session: options.session } : undefined;
    let issuerCredited = false;
    try {
      if (issuerCreditLocal > 0) {
        const balance = await creditCorpLiquidCapital(
          db,
          corp._id,
          issuerCreditLocal,
          true,
          options
        );
        if (balance === null) throw new Error("IPO issuer disappeared during float buy");
        issuerCredited = true;
      }
      if (poolCreditLocal > 0) {
        await creditEquityPool(db, currency, poolCreditLocal, "purchasesIn", new Date(), options);
      }
    } catch (error) {
      if (issuerShares > 0) {
        await db.collection<Corporation>("corporations").updateOne(
          { _id: corp._id },
          {
            $inc: {
              "pendingShareIssuance.remainingShares": issuerShares,
              ...(issuerCredited
                ? { liquidCapital: -issuerCreditLocal, shareIssuanceProceeds: -issuerCreditLocal }
                : {}),
            },
          },
          mongoOptions
        );
      }
      throw error;
    }
    // Keep the caller's snapshot in step with the pool it just credited, so
    // the next quote in the same pass sees the cash skew a per-buy read would.
    if (snapshot) {
      const credited = poolCreditLocal;
      if (Number.isFinite(credited) && credited > 0) {
        snapshot.cashLocal = (snapshot.cashLocal ?? 0) + credited;
      }
    }
    return { issuerShares, issuerCreditLocal, poolCreditLocal };
  }
  if (getShareBuybackMode(corp) === "escrow") {
    await creditCorpShareEscrow(db, corp._id, amountLocal, options);
  } else {
    await creditCorpLiquidCapital(db, corp._id, amountLocal, true, options);
  }
  return { issuerShares: 0, issuerCreditLocal: 0, poolCreditLocal: 0 };
}

/** Re-exported so callers can type the hoisted split without a second import. */
export type { EscrowDebitSplit };

/** Result of a float-sell settlement. `split` is present only in escrow mode. */
export type FloatSellSettlement = { ok: boolean; split?: EscrowDebitSplit };

/**
 * Settle the issuer side of a float SELL.
 * - escrow mode: debit the market-making escrow FLOORED at zero — escrow can
 *   only spend the buyer cash it actually collected; any shortfall is drawn
 *   from real `liquidCapital`. Never blocks the trade (always `ok:true`), and
 *   `shareEscrowBalance` can no longer go negative (no more minted cash). The
 *   returned `split` records how much came from escrow vs treasury so a
 *   rollback can reverse both legs exactly.
 * - instant mode: atomically debit liquidCapital, gated — `ok:false` if the
 *   treasury can't cover (caller surfaces the "use the order book" error).
 */
export async function settleFloatSellDebit(
  db: Db,
  corp: EscrowCorp,
  amountLocal: number,
  options?: EscrowSettlementOptions
): Promise<FloatSellSettlement> {
  const currency = equityPoolCurrency({
    countryId: corp.countryId,
    liquidCurrencyCode: corp.liquidCurrencyCode ?? undefined,
  });
  if (options?.counterparty !== "issuer" && (await readEquityPool(db, currency, options))) {
    const debit = await debitEquityPoolGated(
      db,
      currency,
      amountLocal,
      "salesOut",
      new Date(),
      options
    );
    return { ok: debit.ok };
  }
  if (getShareBuybackMode(corp) === "escrow") {
    const split = await debitCorpShareEscrowFloored(db, corp._id, amountLocal, options);
    return { ok: true, split };
  }
  const debit = await atomicallyDebitCorpLiquidCapital(db, corp._id, amountLocal, options);
  return { ok: debit.ok };
}

/**
 * Reverse a `settleFloatSellDebit` (rollback when a later leg throws).
 * Pass the `split` returned by the matching settle so both the escrow and the
 * treasury legs are undone exactly. When no split is given (instant mode, or a
 * legacy caller), it refunds the full amount to `liquidCapital`.
 */
export async function reverseFloatSellDebit(
  db: Db,
  corp: EscrowCorp,
  amountLocal: number,
  options?: EscrowSettlementOptions & { split?: EscrowDebitSplit }
): Promise<void> {
  const currency = equityPoolCurrency({
    countryId: corp.countryId,
    liquidCurrencyCode: corp.liquidCurrencyCode ?? undefined,
  });
  if (options?.counterparty !== "issuer" && (await readEquityPool(db, currency, options))) {
    await refundEquityPoolDebit(db, currency, amountLocal, "salesOut", new Date(), options);
    return;
  }
  if (getShareBuybackMode(corp) === "escrow") {
    const split = options?.split;
    if (split) {
      if (split.escrowDebited > 0) {
        await creditCorpShareEscrow(db, corp._id, split.escrowDebited, options);
      }
      if (split.treasuryDebited > 0) {
        await refundCorpLiquidCapital(db, corp._id, split.treasuryDebited, options);
      }
    } else {
      // No split recorded — best-effort restore of the whole amount to escrow.
      await creditCorpShareEscrow(db, corp._id, amountLocal, options);
    }
  } else {
    await refundCorpLiquidCapital(db, corp._id, amountLocal, options);
  }
}

/**
 * Best-effort side effect after a float SELL commits. Instant mode backs out
 * realized issuance proceeds in the cash-flow audit marker. Escrow mode is a
 * no-op because it never tracked issuance proceeds.
 */
export async function onFloatSellCommitted(
  db: Db,
  corp: EscrowCorp,
  amountLocal: number,
  options?: EscrowSettlementOptions
): Promise<void> {
  const currency = equityPoolCurrency({
    countryId: corp.countryId,
    liquidCurrencyCode: corp.liquidCurrencyCode ?? undefined,
  });
  if (options?.counterparty !== "issuer" && (await readEquityPool(db, currency, options))) return;
  if (getShareBuybackMode(corp) === "escrow") return;
  // Self-contained capture: this is invoked fire-and-forget (`void
  // onFloatSellCommitted(...)`) from the trade paths, so a rejection here would
  // otherwise be an unhandled promise rejection AND silently drift the corp
  // issuance-proceeds audit marker from reality.
  try {
    await decrementCorpIssuanceProceeds(db, corp._id, amountLocal, options);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "shareEscrowSettlement", op: "onFloatSellCommitted" },
      extra: { corpId: corp._id?.toString(), amountLocal },
    });
  }
}
