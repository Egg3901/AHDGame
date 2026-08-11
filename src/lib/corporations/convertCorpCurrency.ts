import type { Db, AnyBulkWriteOperation, MongoServerError, ClientSession } from "mongodb";
import type { Corporation, CorporateSector, ShareOrder, ShareListing } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import * as Sentry from "@sentry/nextjs";
import { getMongoClient } from "@/lib/mongodb";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { cancelShareOrderAndRefund } from "@/lib/corporations/cancelShareOrder";
import { cancelShareListingAndRefund } from "@/lib/corporations/cancelShareListing";

export type ConvertCorpCurrencyResult = ConvertCorpCurrencySuccess | ConvertCorpCurrencyError;

export interface ConvertCorpCurrencySuccess {
  ok: true;
  converted: boolean;
  fromCurrency?: CurrencyCode;
  toCurrency: CurrencyCode;
  /** LOCAL_new = LOCAL_old × scale (via ₳: toRate / fromRate). 1.0 when fromCurrency is unset (pre-forex ₳). */
  scale: number;
  /** Number of corporateSectors whose revenue + currentGrowthCost were rescaled. */
  sectorsConverted: number;
  /** Open shareOrders cancelled + refunded before conversion. */
  ordersCancelled: number;
  /** Open shareListings cancelled + pending-offer escrows refunded before conversion. */
  listingsCancelled: number;
}

export interface ConvertCorpCurrencyError {
  ok: false;
  /** Set when the failure is recoverable by the caller with a 503-retry semantic. */
  rateUnavailable?: boolean;
  error: string;
}

/**
 * Convert every corp-economic money field from the corp's current
 * `liquidCurrencyCode` to `toCurrencyCode` at the supplied FX rates, and
 * update `liquidCurrencyCode` to match. Used by HQ-relocation paths when a
 * cross-country move changes the corp's home currency.
 *
 * What converts (every field denominated in the corp's `liquidCurrencyCode`
 * per docs/design/corporations.md §Currency handling):
 *   - `corporations`: `liquidCapital`, `sharePrice`, `marketingBudget`,
 *     `logisticsBudget`, `ceoSalary`
 *   - `corporateSectors` owned by this corp: `revenue`, `currentGrowthCost`
 *
 * What does NOT convert:
 *   - **Bonds issued by this corp.** Per design, denomination fixed at
 *     issuance. Coupons + maturity payouts continue in the old currency; the
 *     corp's liquidCapital (now in the new currency) is debited via the
 *     standard `bondTurn.ts` ₳-normalization path, so old-currency bonds on
 *     a new-currency corp settle correctly without any extra work here.
 *   - **Historical rows** (`corporationHistory`, `marketCapHistory`,
 *     `corporationPortfolioHistory`). Each row is stamped with its own
 *     `currencyCode` at write time so mixed-currency rows across the
 *     conversion moment chart correctly.
 *   - **Character wallets.** Multi-currency by design.
 *
 * Open `shareOrders` and `shareListings` (with pending offers) are cancelled
 * + refunded BEFORE the currency field is updated — escrow amounts are in
 * the pre-conversion currency and the existing refund helpers read the
 * corp's current `liquidCurrencyCode` to interpret them, so the order
 * matters: cancel → refund → convert.
 *
 * Pre-forex corps (no `liquidCurrencyCode`) are treated as ₳-denominated
 * (fromRate = 1.0) and stamped with the new currency; this backfills the
 * missing field at the same time.
 */
export async function convertCorpCurrency(
  db: Db,
  corp: Corporation,
  toCurrencyCode: CurrencyCode,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  now: Date,
  forexEnabled: boolean
): Promise<ConvertCorpCurrencyResult> {
  const fromCurrency = resolveCorpLiquidCurrencyCode(corp);
  // No-op: same currency already; nothing to change.
  if (fromCurrency === toCurrencyCode) {
    return {
      ok: true,
      converted: false,
      fromCurrency,
      toCurrency: toCurrencyCode,
      scale: 1,
      sectorsConverted: 0,
      ordersCancelled: 0,
      listingsCancelled: 0,
    };
  }

  // Both source and target FX rates must be present before we mutate anything.
  // Reading with passthrough (rate=1 fallback) is safe for cross-corp aggregation,
  // but for WRITES a missing target rate would persist order-of-magnitude wrong
  // balances — refuse rather than corrupt.
  const fromRate = fromCurrency ? fxByCurrency.get(fromCurrency) : 1;
  const toRate = fxByCurrency.get(toCurrencyCode);
  if (fromRate === undefined || toRate === undefined) {
    return {
      ok: false,
      rateUnavailable: true,
      error: `Exchange rate unavailable for ${fromCurrency ?? "source"}→${toCurrencyCode} conversion, try again shortly`,
    };
  }
  // LOCAL_new = (LOCAL_old / fromRate) * toRate = LOCAL_old * (toRate / fromRate)
  const scale = toRate / fromRate;

  // 1. Cancel open share orders — existing cancel helper reads the corp's
  //    CURRENT liquidCurrencyCode to interpret escrow/pricePerShare, so this
  //    MUST run before the currency field is rewritten. Any failure here aborts
  //    the conversion: a stale-currency open order on a converted corp would
  //    leak player escrow across a currency boundary at next fill / cancel.
  const openOrders = await db
    .collection<ShareOrder>("shareOrders")
    .find({ corporationId: corp._id, status: "open" })
    .toArray();
  let ordersCancelled = 0;
  for (const order of openOrders) {
    const res = await cancelShareOrderAndRefund(db, order);
    if (!res.ok) {
      return {
        ok: false,
        // cancelShareOrderAndRefund's 503-eligible failure mode is missing
        // character FX rate — caller can surface that to retry.
        rateUnavailable: /exchange rate/i.test(res.error),
        error: `Failed to cancel open share order ${order._id.toString()} before currency conversion: ${res.error}`,
      };
    }
    ordersCancelled++;
  }

  // 2. Cancel open share listings (and refund pending-offer escrows) — same
  //    ordering rationale as orders. Also abort-on-failure.
  const openListings = await db
    .collection<ShareListing>("shareListings")
    .find({ corporationId: corp._id, status: "open" })
    .toArray();
  let listingsCancelled = 0;
  for (const listing of openListings) {
    // Pass the corp we already have as `listingCorpDocOverride` — all listings
    // being cancelled here belong to `corp`, so we skip N redundant findOnes.
    const res = await cancelShareListingAndRefund(db, listing, now, forexEnabled, corp);
    if (!res.ok) {
      return {
        ok: false,
        rateUnavailable: res.rateUnavailable === true,
        error: `Failed to cancel open share listing ${listing._id.toString()} before currency conversion: ${res.error}`,
      };
    }
    listingsCancelled++;
  }

  // 3 + 4. Convert corp-economic money fields AND sector revenue atomically.
  //    `corp.liquidCurrencyCode` is the "source of truth" for how downstream
  //    code reads every other money field on the corp and its sectors. Partial
  //    failure (corp flipped but sectors not, or vice versa) produces drift
  //    that turn processing can't detect — so we wrap both writes in a single
  //    MongoDB transaction. On replica-set deployments (Atlas / prod) this is
  //    a hard atomicity guarantee; on standalone dev mongod (no replica set)
  //    we fall back to sequential writes and tolerate the existing
  //    partial-failure risk (consistent with other cross-collection writes
  //    in the codebase — see CLAUDE.md §Cross-collection consistency).
  //
  //    `ceoSalary` is optional on the Corporation type — preserve that: only
  //    `$set` it when the corp already had a value, otherwise leave the
  //    field absent (writing 0 is behaviorally equivalent but changes doc shape).
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const round4 = (v: number) => Math.round(v * 10000) / 10000;
  const corpSet: Record<string, unknown> = {
    liquidCurrencyCode: toCurrencyCode,
    liquidCapital: round2((corp.liquidCapital ?? 0) * scale),
    // sharePrice uses 4-decimal precision elsewhere (see DEFAULT_SHARE_PRICE + MIN_SHARE_PRICE).
    sharePrice: round4((corp.sharePrice ?? 0) * scale),
    marketingBudget: round2((corp.marketingBudget ?? 0) * scale),
    logisticsBudget: round2((corp.logisticsBudget ?? 0) * scale),
    updatedAt: now,
  };
  if (corp.ceoSalary !== undefined) {
    corpSet.ceoSalary = round2(corp.ceoSalary * scale);
  }

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: corp._id })
    .toArray();
  // ─── WHAT AN FX FLIP MAY AND MAY NOT TOUCH ──────────────────────────────
  // `revenue` and `currentGrowthCost` are LOCAL-currency fields, so a change of
  // the owner's currency re-denominates them. The capacity fields are not:
  //   - `capitalStock` is a count of output units/day — currency-free.
  //   - `buildQueue[].costPaidAnchor` and `constructionInProgressAnchor` are
  //     ₳-ANCHORED by definition (see SectorBuildOrder / CorporateSector), i.e.
  //     already currency-independent. Rescaling either by the FX cross would
  //     silently restate cash already spent and inflate every subsequent CIP
  //     figure and 0.75 cancellation refund by that cross rate. They are
  //     deliberately absent from this write and must stay absent.
  //
  // Under plants `revenue` is DERIVED (`capitalStock × mixPrice`, restated by
  // the turn processor each turn in the sector's HOST currency, not the
  // owner's), so rescaling it here is both pointless and a write to a field the
  // engine owns. Gated off at that tier; unchanged below it.
  // PLANTS-GATED: `revenue` is rescaled only BELOW the plants tier. At plants
  // and above the turn processor restates it every turn from `capitalStock x
  // mixPrice` in the sector's HOST currency, which the owner's currency change
  // does not touch, so rescaling here would be both pointless and a write to a
  // field the engine owns. `currentGrowthCost` is still rescaled in every mode.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const sectorOps: AnyBulkWriteOperation<CorporateSector>[] = sectors.map((s) => ({
    updateOne: {
      filter: { _id: s._id },
      update: {
        $set: {
          ...(plantsEnabled ? {} : { revenue: round2((s.revenue ?? 0) * scale) }),
          currentGrowthCost: round2((s.currentGrowthCost ?? 0) * scale),
          updatedAt: now,
        },
      },
    },
  }));

  const applyCorpAndSectors = async (sessionOpts: { session?: ClientSession } = {}) => {
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: corp._id }, { $set: corpSet }, sessionOpts);
    if (sectorOps.length > 0) {
      const bulkResult = await db
        .collection<CorporateSector>("corporateSectors")
        .bulkWrite(sectorOps, sessionOpts);
      // A matchedCount shortfall means sectors exist in the DB that we fetched
      // but the bulkWrite didn't touch — the corp's liquidCurrencyCode would be
      // flipped while those sectors retain old-currency revenue values, inflating
      // sectorNPV and share price by the FX cross rate on the next turn.
      if (bulkResult.matchedCount !== sectorOps.length) {
        const msg =
          `convertCorpCurrency: sector count mismatch for corp ${corp._id.toString()} ` +
          `(${fromCurrency ?? "₳"}→${toCurrencyCode}, scale=${scale.toFixed(6)}): ` +
          `expected ${sectorOps.length} matched, got ${bulkResult.matchedCount}`;
        Sentry.captureException(new Error(msg));
        // Throw so the transaction (if active) aborts before committing the corp update.
        // In the non-transaction fallback the corp write has already landed, but
        // surfacing the error here ensures the relocate route returns 500 rather
        // than silently handing the caller a converted-but-broken corp.
        throw new Error(msg);
      }
    }
  };

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    try {
      await session.withTransaction(async () => {
        await applyCorpAndSectors({ session });
      });
    } catch (err) {
      // Standalone mongods report TransactionNotSupported (code 20). Fall back
      // to sequential writes so dev-on-standalone still functions — production
      // Atlas always runs a replica set and gets the atomicity guarantee.
      const code = (err as MongoServerError | undefined)?.code;
      if (code === 20 || code === 263 /* IllegalOperation for sessions */) {
        await applyCorpAndSectors();
      } else {
        throw err;
      }
    }
  } finally {
    await session.endSession();
  }

  const sectorsConverted = sectors.length;

  return {
    ok: true,
    converted: true,
    fromCurrency,
    toCurrency: toCurrencyCode,
    scale,
    sectorsConverted,
    ordersCancelled,
    listingsCancelled,
  };
}
