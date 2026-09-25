import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { sellBondSchema } from "@/lib/api/schemas/bonds";
import { badRequest, conflict, handleRouteError, notFound } from "@/lib/api/errors";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import type { Bond, Character, Corporation, ExchangeRate, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { emitTx } from "@/lib/financialTxLog/emit";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import {
  bondPoolDepthMessage,
  bondPoolFillableUnits,
  loadBondQuote,
  readBondPoolCash,
} from "@/lib/bonds/marketPool";
import {
  applyBondSellSpend,
  BOND_SELL_INSUFFICIENT,
  BOND_SELL_PAYOUT_MISSING,
  BOND_SELL_POOL_DEPTH,
} from "@/lib/bonds/bondSellSpend";

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

    // Crash-safe settlement (issue #1672): a client retry with the same key
    // replays the stored sale outcome instead of selling again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }
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
    if (fillableUnits < units) {
      // A retry of a sale that already started may itself account for the
      // apparent pool shortfall (its own pool debit landed). When the client
      // presents an Idempotency-Key with a live receipt, skip the upfront
      // refusal and let the keyed flow reconcile the attempt (replay the
      // stored outcome, resume the crashed prefix, or fail closed) instead
      // of rejecting the retry on a stale pool read.
      let resumeKeyed = false;
      if (headerKey !== null) {
        const receipts = await getMoneyFlowReceiptsCollection(db);
        resumeKeyed = (await receipts.findOne({ _id: headerKey })) !== null;
      }
      if (!resumeKeyed) {
        return NextResponse.json(
          {
            error: bondPoolDepthMessage(fillableUnits, bondCurrency),
            marketDepthUnits: fillableUnits,
          },
          { status: 409 }
        );
      }
    }
    const poolDepthRefusal = async () => {
      const cash = await readBondPoolCash(db, bondCurrency);
      return badRequest(
        bondPoolDepthMessage(bondPoolFillableUnits(cash, pricePerUnitLocal, units), bondCurrency)
      );
    };

    // Map a keyed-settlement failure back onto the historical surface: a
    // lost holder race reports current holdings (400), a lost pool race the
    // depth refusal (400 after the upfront 409 pre-check), a vanished seller
    // the 404. The primitive already compensated any applied prefix.
    const mapSellError = async (
      error: unknown,
      sellerLabel: string,
      holderKey: "corporationId" | "imperialCharacterId" | "characterId",
      holderId: ObjectId
    ): Promise<never> => {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith(BOND_SELL_INSUFFICIENT)) {
        const refreshedBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
        const refreshedUnits = refreshedBond
          ? readHolderUnits(refreshedBond, holderKey, holderId)
          : 0;
        throw badRequest(`Insufficient bond holdings. You hold ${refreshedUnits} units`);
      }
      if (message.startsWith(BOND_SELL_POOL_DEPTH)) throw await poolDepthRefusal();
      if (message.startsWith(BOND_SELL_PAYOUT_MISSING)) throw notFound(`${sellerLabel} not found`);
      if (error instanceof MoneyFlowKeyConflictError || error instanceof MoneyFlowTerminalError) {
        throw conflict(error.message);
      }
      throw error;
    };

    // Zero-unit holder cleanup is not a money write: it runs post-commit as
    // a best effort (empty rows are harmless) so a cleanup failure can never
    // fail a sale whose money already moved.
    const cleanupHolder = async (
      holderKey: "corporationId" | "imperialCharacterId" | "characterId",
      holderId: ObjectId
    ): Promise<void> => {
      try {
        await db
          .collection("bonds")
          .updateOne({ _id: bond._id }, buildHolderCleanupUpdate(holderKey, holderId, now));
      } catch {
        // Best effort: lingering zero-unit rows match no claim guard.
      }
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

      const currentUnits = readHolderUnits(bond, "corporationId", corp._id);
      if (currentUnits < units) {
        return NextResponse.json(
          { error: `Insufficient bond holdings. You hold ${currentUnits} units` },
          { status: 400 }
        );
      }

      const bondRateDoc = await db
        .collection<ExchangeRate>("exchangeRates")
        .findOne({ currencyCode: bondCurrency });
      const bondFxRate = bondRateDoc?.rate && bondRateDoc.rate > 0 ? bondRateDoc.rate : 1;
      const proceedsAnchor = corpCapitalToAnchor(proceedsLocal, bondCurrency, bondFxRate);
      const corpFxRate = await getCorpFxRate(db, corp);
      const proceedsInCorpCapital = anchorToCorpLiquidCapital(proceedsAnchor, corp, corpFxRate);

      try {
        await applyBondSellSpend(db, {
          bondId: bond._id,
          sellerKind: "corporation",
          sellerId: corp._id,
          units,
          proceedsLocal,
          payoutAmount: proceedsInCorpCapital,
          bondCurrency,
          forexEnabled,
          now,
          fingerprint: `bond-sell:${bond._id.toHexString()}:corporation:${corp._id.toHexString()}:${units}:${proceedsLocal}:${proceedsInCorpCapital}`,
          ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
        });
      } catch (error) {
        await mapSellError(error, "Corporation", "corporationId", corp._id);
      }
      await cleanupHolder("corporationId", corp._id);

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

      const currentUnits = readHolderUnits(bond, "imperialCharacterId", imperial._id);
      if (currentUnits < units) {
        return NextResponse.json(
          { error: `Insufficient bond holdings. You hold ${currentUnits} units` },
          { status: 400 }
        );
      }

      try {
        await applyBondSellSpend(db, {
          bondId: bond._id,
          sellerKind: "imperial",
          sellerId: imperial._id,
          units,
          proceedsLocal,
          payoutAmount: proceedsLocal,
          bondCurrency,
          forexEnabled,
          now,
          fingerprint: `bond-sell:${bond._id.toHexString()}:imperial:${imperial._id.toHexString()}:${units}:${proceedsLocal}`,
          ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
        });
      } catch (error) {
        await mapSellError(error, "Imperial character", "imperialCharacterId", imperial._id);
      }
      await cleanupHolder("imperialCharacterId", imperial._id);

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

    const currentUnits = readHolderUnits(bond, "characterId", character._id);
    if (currentUnits < units) {
      return NextResponse.json(
        { error: `Insufficient bond holdings. You hold ${currentUnits} units` },
        { status: 400 }
      );
    }

    try {
      await applyBondSellSpend(db, {
        bondId: bond._id,
        sellerKind: "character",
        sellerId: character._id,
        units,
        proceedsLocal,
        payoutAmount: proceedsLocal,
        bondCurrency,
        forexEnabled,
        now,
        fingerprint: `bond-sell:${bond._id.toHexString()}:character:${character._id.toHexString()}:${units}:${proceedsLocal}`,
        ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
      });
    } catch (error) {
      await mapSellError(error, "Character", "characterId", character._id);
    }
    await cleanupHolder("characterId", character._id);

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
