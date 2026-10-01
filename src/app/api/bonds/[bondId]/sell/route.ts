import { NextResponse } from "next/server";
import { ObjectId, type Db, type Document, type Filter, type UpdateFilter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { sellBondSchema } from "@/lib/api/schemas/bonds";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
import type { Bond, Character, Corporation, ExchangeRate, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { emitTx } from "@/lib/financialTxLog/emit";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import * as Sentry from "@sentry/nextjs";
import {
  bondPoolDepthMessage,
  bondPoolFillableUnits,
  debitBondPoolGated,
  loadBondQuote,
  readBondPoolCash,
} from "@/lib/bonds/marketPool";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import { SETTLED_KEYS_FIELD } from "@/lib/banking/moneyMove";
import {
  advanceBondSaleIntent,
  bondSaleLegStamp,
  createBondSaleIntent,
  documentHasStamp,
  loadPendingBondSaleIntents,
  markBondSaleIntentBestEffort,
  settledKeyPush,
  BOND_SALE_INTENT_COLLECTION,
  type BondSaleIntent,
  type BondSaleSettlementOps,
} from "@/lib/bonds/saleRecovery";

interface RouteParams {
  params: Promise<{ bondId: string }>;
}

function readHolderUnits(
  bond: Bond,
  holderKey: "corporationId" | "imperialCharacterId" | "characterId",
  holderId: ObjectId
) {
  return (
    bond.holders.find((holder) => holder[holderKey]?.toString() === holderId.toString())?.units ?? 0
  );
}

function buildHolderCleanupUpdate(
  holderKey: "corporationId" | "imperialCharacterId" | "characterId",
  holderId: ObjectId,
  now: Date
) {
  return [
    {
      $set: {
        holders: {
          $filter: {
            input: "$holders",
            as: "holder",
            cond: {
              $not: {
                $and: [
                  { $eq: [`$$holder.${holderKey}`, holderId] },
                  { $lte: ["$$holder.units", 0] },
                ],
              },
            },
          },
        },
        updatedAt: now,
      },
    },
  ];
}

type BondSaleHolderKey = "corporationId" | "imperialCharacterId" | "characterId";

interface BondSaleSeller {
  holderKey: BondSaleHolderKey;
  holderId: ObjectId;
  sellerCollection: BondSaleIntent["sellerCollection"];
  /** Exact seller credit, in the seller document's own balance fields. */
  payoutInc: Record<string, number>;
}

function roundBondSaleCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Guarded settlement writes for one sale intent, built from its STORED terms.
 * A resume therefore replays the original proceeds, never a fresh quote, and
 * every leg carries the intent's stamp so a landed leg verifies as landed
 * without moving anything twice.
 */
function buildBondSaleFallbackOps(db: Db, intent: BondSaleIntent): BondSaleSettlementOps {
  return {
    claimLanded: async () => {
      const bondDoc = await db
        .collection<Bond>("bonds")
        .findOne({ _id: intent.bondId }, { projection: { holders: 1 } });
      return (
        bondDoc?.holders.some(
          (holder) =>
            holder[intent.holderKey]?.toString() === intent.holderId.toString() &&
            holder.saleIntentId?.toString() === intent._id.toString()
        ) ?? false
      );
    },
    debitPool: async (stamp) => {
      if (
        await documentHasStamp(
          db,
          BOND_MARKET_POOLS_COLLECTION,
          { _id: intent.poolCurrency },
          stamp
        )
      ) {
        return "already";
      }
      const debit = await debitBondPoolGated(
        db,
        intent.poolCurrency,
        intent.proceedsLocal,
        "salesOut",
        new Date(),
        { stamp }
      );
      if (debit.ok) return "applied";
      // Lost a race with a concurrent resume, or the pool is dry. The stamp
      // tells the two apart: present means the debit landed after all.
      if (
        await documentHasStamp(
          db,
          BOND_MARKET_POOLS_COLLECTION,
          { _id: intent.poolCurrency },
          stamp
        )
      ) {
        return "already";
      }
      return "refused";
    },
    paySeller: async (stamp) => {
      const payout = await db.collection(intent.sellerCollection).updateOne(
        { _id: intent.holderId, [SETTLED_KEYS_FIELD]: { $ne: stamp } } as Filter<Document>,
        {
          $inc: intent.payoutInc,
          $set: { updatedAt: new Date() },
          $push: settledKeyPush(stamp),
        } as unknown as UpdateFilter<Document>
      );
      if (payout.modifiedCount === 1) return "applied";
      if (await documentHasStamp(db, intent.sellerCollection, { _id: intent.holderId }, stamp)) {
        return "already";
      }
      const seller = await db
        .collection(intent.sellerCollection)
        .findOne({ _id: intent.holderId }, { projection: { _id: 1 } });
      return seller ? "already" : "missing";
    },
    restoreClaim: async () => {
      await db.collection<Bond>("bonds").updateOne(
        {
          _id: intent.bondId,
          holders: {
            $elemMatch: { [intent.holderKey]: intent.holderId, saleIntentId: intent._id },
          },
        },
        {
          $inc: { "holders.$.units": intent.units, publicFloat: -intent.units },
          $unset: { "holders.$.saleIntentId": "" },
          $set: { updatedAt: new Date() },
        }
      );
    },
    refundPool: async () => {
      // Inline rather than refundBondPoolDebit: the stamp must be pulled in
      // the SAME write that returns the cash, or a concurrent resume could
      // read a refunded pool as still-debited and pay the seller twice.
      const stamp = bondSaleLegStamp(intent._id, "pool");
      const amount = roundBondSaleCents(intent.proceedsLocal);
      await db.collection(BOND_MARKET_POOLS_COLLECTION).updateOne(
        { _id: intent.poolCurrency, [SETTLED_KEYS_FIELD]: stamp } as unknown as Filter<Document>,
        {
          $inc: { cashLocal: amount, "lifetime.salesOut": -amount },
          $set: { updatedAt: new Date() },
          $pull: { [SETTLED_KEYS_FIELD]: stamp },
        } as unknown as UpdateFilter<Document>
      );
    },
  };
}

interface ResumePendingBondSaleArgs {
  bond: Bond;
  units: number;
  proceedsLocal: number;
  seller: BondSaleSeller;
  now: Date;
}

/**
 * Finish any sale this seller started but never completed (process death
 * between the claim write and the payout). Returns the resumed intent when a
 * retry lands on a sale it already started, so the route answers success
 * without interpreting the retry as a second sale. This deliberately wins
 * over a newly computed quote: a request arriving while an earlier intent is
 * pending first completes that original operation on its stored terms.
 */
async function resumePendingBondSale(
  db: Db,
  args: ResumePendingBondSaleArgs
): Promise<BondSaleIntent | null> {
  const pending = await loadPendingBondSaleIntents(
    db,
    args.bond._id,
    args.seller.holderKey,
    args.seller.holderId
  );
  for (const old of pending) {
    const outcome = await advanceBondSaleIntent(db, old, buildBondSaleFallbackOps(db, old));
    if (outcome === "applied") {
      await cleanupEmptyHolderBestEffort(db, args.bond._id, old.holderKey, old.holderId, args.now);
      return old;
    }
  }
  return null;
}

interface RunBondSaleFallbackArgs extends ResumePendingBondSaleArgs {
  bondCurrency: CurrencyCode;
  throwPoolDepthRefusal: () => Promise<unknown>;
  throwSellerMissing: () => never;
}

/**
 * Standalone-Mongo settlement for one sale. The intent row is inserted BEFORE
 * the holder claim, so a crash at any later point leaves a pending intent the
 * next attempt resumes (see {@link resumePendingBondSale}); the claim, pool
 * debit, and payout each carry the intent's stamp, so resume verifies landed
 * legs instead of repeating them.
 */
async function runBondSaleFallbackSettlement(
  db: Db,
  args: RunBondSaleFallbackArgs
): Promise<BondSaleIntent> {
  const { bond, units, seller, now } = args;
  const reportMarkError = (error: unknown) => {
    Sentry.captureException(error, {
      tags: { operation: "bond-sell-intent-mark" },
      extra: { bondId: bond._id.toString() },
    });
  };
  const intent = await createBondSaleIntent(db, {
    bondId: bond._id,
    holderKey: seller.holderKey,
    holderId: seller.holderId,
    sellerCollection: seller.sellerCollection,
    units,
    proceedsLocal: args.proceedsLocal,
    poolCurrency: args.bondCurrency,
    payoutInc: seller.payoutInc,
  });
  const ops = buildBondSaleFallbackOps(db, intent);
  const claimFilter = {
    _id: bond._id,
    defaulted: false,
    holders: {
      $elemMatch: {
        [seller.holderKey]: seller.holderId,
        units: { $gte: units },
        saleIntentId: { $exists: false },
      },
    },
  };
  const claimUpdate = {
    $inc: { "holders.$.units": -units, publicFloat: units },
    $set: { updatedAt: now, "holders.$.saleIntentId": intent._id },
  };

  let claimed: boolean;
  try {
    const claimResult = await db.collection<Bond>("bonds").updateOne(claimFilter, claimUpdate);
    claimed = claimResult.modifiedCount > 0;
  } catch (error) {
    if (await ops.claimLanded()) {
      // Ambiguous failure: the claim landed server-side while its response
      // was lost. Finish it instead of abandoning claimed units.
      claimed = true;
    } else {
      await markBondSaleIntentBestEffort(
        db,
        intent._id,
        { status: "rejected", error: "claim write failed" },
        reportMarkError
      );
      throw error;
    }
  }
  if (!claimed) {
    if (await ops.claimLanded()) {
      claimed = true;
    } else {
      await markBondSaleIntentBestEffort(
        db,
        intent._id,
        { status: "rejected", error: "insufficient holdings" },
        reportMarkError
      );
      const refreshedBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
      const refreshedUnits = refreshedBond
        ? readHolderUnits(refreshedBond, seller.holderKey, seller.holderId)
        : 0;
      throw badRequest(`Insufficient bond holdings. You hold ${refreshedUnits} units`);
    }
  }
  await markBondSaleIntentBestEffort(db, intent._id, { claimApplied: true }, reportMarkError);

  const outcome = await advanceBondSaleIntent(db, { ...intent, claimApplied: true }, ops, {
    claimConfirmed: true,
  });
  if (outcome === "reverted") {
    const settled = await db
      .collection<BondSaleIntent>(BOND_SALE_INTENT_COLLECTION)
      .findOne({ _id: intent._id });
    // Only the seller-missing path reverts with the pool still debited, and
    // only the pool-dry path reverts without it.
    if (settled?.poolDebited) throw args.throwSellerMissing();
    throw await args.throwPoolDepthRefusal();
  }
  await cleanupEmptyHolderBestEffort(db, bond._id, seller.holderKey, seller.holderId, now);
  return intent;
}

async function cleanupEmptyHolderBestEffort(
  db: Awaited<ReturnType<typeof getDb>>,
  bondId: ObjectId,
  holderKey: "corporationId" | "imperialCharacterId" | "characterId",
  holderId: ObjectId,
  now: Date
) {
  try {
    await db
      .collection("bonds")
      .updateOne({ _id: bondId }, buildHolderCleanupUpdate(holderKey, holderId, now));
  } catch (error) {
    // The sale is already financially complete. A zero-unit holder row is
    // harmless and can be removed later; rolling the sale back here would
    // restore the asset and pool cash without reversing the seller payout.
    Sentry.captureException(error, {
      tags: { operation: "bond-sell-holder-cleanup" },
      extra: { bondId: bondId.toString(), holderKey, holderId: holderId.toString() },
    });
  }
}

/**
 * POST /api/bonds/[bondId]/sell
 * Sell bond units to the currency's bond market pool at current market price.
 * The pool pays from its own cash, so a sale the pool cannot cover is refused
 * with the size it can take. Cannot sell defaulted bonds.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const user = auth.user;

    const { bondId } = await params;
    const parsed = await parseJsonBody(request, sellBondSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { units } = parsed.data;
    const db = await getDb();

    // Bond trading is a corporate-market action: blocked for both corporations
    // and individual players while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const forexEnabled = await isForexEnabled();

    const bond = await db.collection<Bond>("bonds").findOne({ _id: new ObjectId(bondId) });
    if (!bond) {
      return NextResponse.json({ error: "Bond not found" }, { status: 404 });
    }

    if (bond.defaulted) {
      return NextResponse.json({ error: "Cannot sell a defaulted bond" }, { status: 400 });
    }

    // Bond denomination — canonical key is `bond.currencyCode` (Task-18B); we
    // intentionally do not derive from the issuer corp's current country so that
    // admin-initiated cross-country HQ moves don't silently re-denominate
    // outstanding bonds (see docs/design/corporations.md §HQ Relocation).
    const bondCurrency: CurrencyCode = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : "USD")) as CurrencyCode;

    const url = new URL(request.url);
    const sellAsCorp = url.searchParams.get("corporationId");
    const now = new Date();
    // The pool buys at its bid: the rate-derived mid less the dealer half
    // spread, shifted down when the pool is short of cash or has little
    // appetite for the issuer.
    const quote = await loadBondQuote(db, bond);
    const proceedsLocal = units * quote.bidPerUnit;
    const turnDoc = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = turnDoc?.currentTurn ?? 0;

    // Depth check before any holder-side write. The gated debit inside each
    // settlement path is the real guard; this read just turns a race-free
    // refusal into a message that says how much the market can take.
    const pricePerUnitLocal = quote.bidPerUnit;
    const fillableUnits = bondPoolFillableUnits(quote.poolCashLocal, pricePerUnitLocal, units);
    const pendingSale = await db
      .collection<BondSaleIntent>(BOND_SALE_INTENT_COLLECTION)
      .findOne({ bondId: bond._id, status: "claimed" }, { projection: { _id: 1 } });
    // A pending sale may itself account for the apparent pool shortfall. Let
    // its seller-specific branch resume the stamped debit instead of rejecting
    // the retry from a newly observed pool balance.
    if (fillableUnits < units && !pendingSale) {
      return NextResponse.json(
        {
          error: bondPoolDepthMessage(fillableUnits, bondCurrency),
          marketDepthUnits: fillableUnits,
        },
        { status: 409 }
      );
    }
    const poolDepthRefusal = async () => {
      const cash = await readBondPoolCash(db, bondCurrency);
      return badRequest(
        bondPoolDepthMessage(bondPoolFillableUnits(cash, pricePerUnitLocal, units), bondCurrency)
      );
    };

    if (sellAsCorp) {
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: new ObjectId(sellAsCorp) });
      if (!corp) {
        return NextResponse.json({ error: "Corporation not found" }, { status: 404 });
      }
      if (corp.userId?.toString() !== user.userId) {
        return NextResponse.json(
          { error: "Only the CEO can sell bonds for a corporation" },
          { status: 403 }
        );
      }

      const bondRateDoc = await db
        .collection<ExchangeRate>("exchangeRates")
        .findOne({ currencyCode: bondCurrency });
      const bondFxRate = bondRateDoc?.rate && bondRateDoc.rate > 0 ? bondRateDoc.rate : 1;
      const proceedsAnchor = corpCapitalToAnchor(proceedsLocal, bondCurrency, bondFxRate);
      const corpFxRate = await getCorpFxRate(db, corp);
      const proceedsInCorpCapital = anchorToCorpLiquidCapital(proceedsAnchor, corp, corpFxRate);
      const claimFilter = {
        _id: bond._id,
        defaulted: false,
        holders: {
          $elemMatch: {
            corporationId: corp._id,
            units: { $gte: units },
          },
        },
      };
      const claimUpdate = {
        $inc: { "holders.$.units": -units, publicFloat: units },
        $set: { updatedAt: now },
      };
      await runWithOptionalTransaction(
        async (session) => {
          const currentUnits = readHolderUnits(bond, "corporationId", corp._id);
          if (currentUnits < units) {
            throw badRequest(`Insufficient bond holdings. You hold ${currentUnits} units`);
          }
          const claimResult = await db
            .collection<Bond>("bonds")
            .updateOne(claimFilter, claimUpdate, { session });
          if (claimResult.modifiedCount === 0) {
            throw badRequest("Insufficient bond holdings");
          }
          const poolDebit = await debitBondPoolGated(
            db,
            bondCurrency,
            proceedsLocal,
            "salesOut",
            now,
            { session }
          );
          if (!poolDebit.ok) throw await poolDepthRefusal();

          const payoutResult = await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: corp._id },
              { $inc: { liquidCapital: proceedsInCorpCapital }, $set: { updatedAt: now } },
              { session }
            );
          if (payoutResult.matchedCount === 0) {
            throw notFound("Corporation not found");
          }

          await db
            .collection("bonds")
            .updateOne(
              { _id: bond._id },
              buildHolderCleanupUpdate("corporationId", corp._id, now),
              { session }
            );
        },
        async () => {
          const seller: BondSaleSeller = {
            holderKey: "corporationId",
            holderId: corp._id,
            sellerCollection: "corporations",
            payoutInc: { liquidCapital: proceedsInCorpCapital },
          };
          const resumed = await resumePendingBondSale(db, {
            bond,
            units,
            proceedsLocal,
            seller,
            now,
          });
          if (!resumed) {
            await runBondSaleFallbackSettlement(db, {
              bond,
              units,
              proceedsLocal,
              seller,
              now,
              bondCurrency,
              throwPoolDepthRefusal: poolDepthRefusal,
              throwSellerMissing: () => {
                throw notFound("Corporation not found");
              },
            });
          }
        }
      );

      void emitTx(db, {
        type: "bond_sell",
        turn: currentTurn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: corp._id,
        subjectName: corp.name,
        amount: proceedsInCorpCapital,
        currencyCode: resolveCorpLiquidCurrencyCode(corp) ?? "USD",
        counterpartyType: "system",
        counterpartyName: bond.issuerName ?? "Bond market",
        meta: {
          bondId: bond._id.toString(),
          units,
          pricePerUnit: quote.bid,
          bondCurrency,
          bondAmount: Math.round(proceedsLocal * 100) / 100,
        },
      });

      return NextResponse.json({
        success: true,
        unitsSold: units,
        proceeds: Math.round(proceedsLocal * 100) / 100,
        proceedsCurrency: bondCurrency,
        pricePerUnit: quote.bidPerUnit,
        seller: "corporation",
      });
    }

    const userDoc = await db.collection<User>("users").findOne({ _id: new ObjectId(user.userId) });
    const isImperialMode =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    if (isImperialMode) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc.activeImperialCharacterId!,
        userId: new ObjectId(user.userId),
      });
      if (!imperial) {
        return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
      }

      const claimFilter = {
        _id: bond._id,
        defaulted: false,
        holders: {
          $elemMatch: {
            imperialCharacterId: imperial._id,
            units: { $gte: units },
          },
        },
      };
      const claimUpdate = {
        $inc: { "holders.$.units": -units, publicFloat: units },
        $set: { updatedAt: now },
      };
      const payoutUpdate = {
        $inc: { ...buildPersonalBalanceInc(proceedsLocal, bondCurrency, forexEnabled) },
        $set: { updatedAt: now },
      };
      await runWithOptionalTransaction(
        async (session) => {
          const currentUnits = readHolderUnits(bond, "imperialCharacterId", imperial._id);
          if (currentUnits < units) {
            throw badRequest(`Insufficient bond holdings. You hold ${currentUnits} units`);
          }
          const claimResult = await db
            .collection<Bond>("bonds")
            .updateOne(claimFilter, claimUpdate, { session });
          if (claimResult.modifiedCount === 0) {
            throw badRequest("Insufficient bond holdings");
          }
          const poolDebit = await debitBondPoolGated(
            db,
            bondCurrency,
            proceedsLocal,
            "salesOut",
            now,
            { session }
          );
          if (!poolDebit.ok) throw await poolDepthRefusal();

          const payoutResult = await db
            .collection<ImperialCharacter>("imperialCharacters")
            .updateOne({ _id: imperial._id }, payoutUpdate, { session });
          if (payoutResult.matchedCount === 0) {
            throw notFound("Imperial character not found");
          }

          await db
            .collection("bonds")
            .updateOne(
              { _id: bond._id },
              buildHolderCleanupUpdate("imperialCharacterId", imperial._id, now),
              { session }
            );
        },
        async () => {
          const seller: BondSaleSeller = {
            holderKey: "imperialCharacterId",
            holderId: imperial._id,
            sellerCollection: "imperialCharacters",
            payoutInc: buildPersonalBalanceInc(proceedsLocal, bondCurrency, forexEnabled),
          };
          const resumed = await resumePendingBondSale(db, {
            bond,
            units,
            proceedsLocal,
            seller,
            now,
          });
          if (!resumed) {
            await runBondSaleFallbackSettlement(db, {
              bond,
              units,
              proceedsLocal,
              seller,
              now,
              bondCurrency,
              throwPoolDepthRefusal: poolDepthRefusal,
              throwSellerMissing: () => {
                throw notFound("Imperial character not found");
              },
            });
          }
        }
      );

      void emitTx(db, {
        type: "bond_sell",
        turn: currentTurn,
        createdAt: now,
        subjectType: "character",
        subjectId: imperial._id,
        subjectName: imperial.name,
        amount: proceedsLocal,
        currencyCode: bondCurrency,
        counterpartyType: "system",
        counterpartyName: bond.issuerName ?? "Bond market",
        meta: {
          bondId: bond._id.toString(),
          units,
          pricePerUnit: quote.bid,
          imperial: true,
        },
      });

      return NextResponse.json({
        success: true,
        unitsSold: units,
        proceeds: Math.round(proceedsLocal * 100) / 100,
        proceedsCurrency: bondCurrency,
        pricePerUnit: quote.bidPerUnit,
        seller: "character",
      });
    }

    const characterQuery = userDoc?.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(user.userId) }
      : { userId: new ObjectId(user.userId) };
    const character = await db.collection<Character>("characters").findOne(characterQuery);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const claimFilter = {
      _id: bond._id,
      defaulted: false,
      holders: {
        $elemMatch: {
          characterId: character._id,
          units: { $gte: units },
        },
      },
    };
    const claimUpdate = {
      $inc: { "holders.$.units": -units, publicFloat: units },
      $set: { updatedAt: now },
    };
    const payoutUpdate = {
      $inc: { ...buildPersonalBalanceInc(proceedsLocal, bondCurrency, forexEnabled) },
      $set: { updatedAt: now },
    };
    await runWithOptionalTransaction(
      async (session) => {
        const currentUnits = readHolderUnits(bond, "characterId", character._id);
        if (currentUnits < units) {
          throw badRequest(`Insufficient bond holdings. You hold ${currentUnits} units`);
        }
        const claimResult = await db
          .collection<Bond>("bonds")
          .updateOne(claimFilter, claimUpdate, { session });
        if (claimResult.modifiedCount === 0) {
          throw badRequest("Insufficient bond holdings");
        }
        const poolDebit = await debitBondPoolGated(
          db,
          bondCurrency,
          proceedsLocal,
          "salesOut",
          now,
          { session }
        );
        if (!poolDebit.ok) throw await poolDepthRefusal();

        const payoutResult = await db
          .collection<Character>("characters")
          .updateOne({ _id: character._id }, payoutUpdate, { session });
        if (payoutResult.matchedCount === 0) {
          throw notFound("Character not found");
        }

        await db
          .collection("bonds")
          .updateOne(
            { _id: bond._id },
            buildHolderCleanupUpdate("characterId", character._id, now),
            { session }
          );
      },
      async () => {
        const seller: BondSaleSeller = {
          holderKey: "characterId",
          holderId: character._id,
          sellerCollection: "characters",
          payoutInc: buildPersonalBalanceInc(proceedsLocal, bondCurrency, forexEnabled),
        };
        const resumed = await resumePendingBondSale(db, {
          bond,
          units,
          proceedsLocal,
          seller,
          now,
        });
        if (!resumed) {
          await runBondSaleFallbackSettlement(db, {
            bond,
            units,
            proceedsLocal,
            seller,
            now,
            bondCurrency,
            throwPoolDepthRefusal: poolDepthRefusal,
            throwSellerMissing: () => {
              throw notFound("Character not found");
            },
          });
        }
      }
    );

    void emitTx(db, {
      type: "bond_sell",
      turn: currentTurn,
      createdAt: now,
      subjectType: "character",
      subjectId: character._id,
      subjectName: character.name,
      amount: proceedsLocal,
      currencyCode: bondCurrency,
      counterpartyType: "system",
      counterpartyName: bond.issuerName ?? "Bond market",
      meta: {
        bondId: bond._id.toString(),
        units,
        pricePerUnit: quote.bid,
      },
    });

    return NextResponse.json({
      success: true,
      unitsSold: units,
      proceeds: Math.round(proceedsLocal * 100) / 100,
      proceedsCurrency: bondCurrency,
      pricePerUnit: quote.bidPerUnit,
      seller: "character",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
