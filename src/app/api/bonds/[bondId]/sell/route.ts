import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { sellBondSchema } from "@/lib/api/schemas/bonds";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
import type { Bond, Character, Corporation, ExchangeRate, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
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
 * Sell bond units back to the AI market maker at current market price.
 * Cannot sell defaulted bonds.
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
    const proceedsLocal = units * BOND_UNIT_FACE_VALUE * bond.marketPrice;
    const turnDoc = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = turnDoc?.currentTurn ?? 0;

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
      const rollbackClaim = async () => {
        await db.collection<Bond>("bonds").updateOne(
          { _id: bond._id, "holders.corporationId": corp._id },
          {
            $inc: { "holders.$.units": units, publicFloat: -units },
            $set: { updatedAt: new Date() },
          }
        );
      };

      await runWithOptionalTransaction(
        async (session) => {
          const claimResult = await db
            .collection<Bond>("bonds")
            .updateOne(claimFilter, claimUpdate, { session });
          if (claimResult.modifiedCount === 0) {
            throw badRequest("Insufficient bond holdings");
          }

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
          const claimResult = await db
            .collection<Bond>("bonds")
            .updateOne(claimFilter, claimUpdate);
          if (claimResult.modifiedCount === 0) {
            const refreshedBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
            const refreshedUnits = refreshedBond
              ? readHolderUnits(refreshedBond, "corporationId", corp._id)
              : 0;
            throw badRequest(`Insufficient bond holdings. You hold ${refreshedUnits} units`);
          }

          try {
            const payoutResult = await db
              .collection<Corporation>("corporations")
              .updateOne(
                { _id: corp._id },
                { $inc: { liquidCapital: proceedsInCorpCapital }, $set: { updatedAt: now } }
              );
            if (payoutResult.matchedCount === 0) {
              throw notFound("Corporation not found");
            }

            await db
              .collection("bonds")
              .updateOne(
                { _id: bond._id },
                buildHolderCleanupUpdate("corporationId", corp._id, now)
              );
          } catch (error) {
            await rollbackClaim();
            throw error;
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
          pricePerUnit: bond.marketPrice,
          bondCurrency,
          bondAmount: Math.round(proceedsLocal * 100) / 100,
        },
      });

      return NextResponse.json({
        success: true,
        unitsSold: units,
        proceeds: Math.round(proceedsLocal * 100) / 100,
        proceedsCurrency: bondCurrency,
        pricePerUnit: Math.round(BOND_UNIT_FACE_VALUE * bond.marketPrice * 100) / 100,
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
      const rollbackClaim = async () => {
        await db.collection<Bond>("bonds").updateOne(
          { _id: bond._id, "holders.imperialCharacterId": imperial._id },
          {
            $inc: { "holders.$.units": units, publicFloat: -units },
            $set: { updatedAt: new Date() },
          }
        );
      };

      await runWithOptionalTransaction(
        async (session) => {
          const claimResult = await db
            .collection<Bond>("bonds")
            .updateOne(claimFilter, claimUpdate, { session });
          if (claimResult.modifiedCount === 0) {
            throw badRequest("Insufficient bond holdings");
          }

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
          const claimResult = await db
            .collection<Bond>("bonds")
            .updateOne(claimFilter, claimUpdate);
          if (claimResult.modifiedCount === 0) {
            const refreshedBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
            const refreshedUnits = refreshedBond
              ? readHolderUnits(refreshedBond, "imperialCharacterId", imperial._id)
              : 0;
            throw badRequest(`Insufficient bond holdings. You hold ${refreshedUnits} units`);
          }

          try {
            const payoutResult = await db
              .collection<ImperialCharacter>("imperialCharacters")
              .updateOne({ _id: imperial._id }, payoutUpdate);
            if (payoutResult.matchedCount === 0) {
              throw notFound("Imperial character not found");
            }

            await db
              .collection("bonds")
              .updateOne(
                { _id: bond._id },
                buildHolderCleanupUpdate("imperialCharacterId", imperial._id, now)
              );
          } catch (error) {
            await rollbackClaim();
            throw error;
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
          pricePerUnit: bond.marketPrice,
          imperial: true,
        },
      });

      return NextResponse.json({
        success: true,
        unitsSold: units,
        proceeds: Math.round(proceedsLocal * 100) / 100,
        proceedsCurrency: bondCurrency,
        pricePerUnit: Math.round(BOND_UNIT_FACE_VALUE * bond.marketPrice * 100) / 100,
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
    const rollbackClaim = async () => {
      await db.collection<Bond>("bonds").updateOne(
        { _id: bond._id, "holders.characterId": character._id },
        {
          $inc: { "holders.$.units": units, publicFloat: -units },
          $set: { updatedAt: new Date() },
        }
      );
    };

    await runWithOptionalTransaction(
      async (session) => {
        const claimResult = await db
          .collection<Bond>("bonds")
          .updateOne(claimFilter, claimUpdate, { session });
        if (claimResult.modifiedCount === 0) {
          throw badRequest("Insufficient bond holdings");
        }

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
        const claimResult = await db.collection<Bond>("bonds").updateOne(claimFilter, claimUpdate);
        if (claimResult.modifiedCount === 0) {
          const refreshedBond = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
          const refreshedUnits = refreshedBond
            ? readHolderUnits(refreshedBond, "characterId", character._id)
            : 0;
          throw badRequest(`Insufficient bond holdings. You hold ${refreshedUnits} units`);
        }

        try {
          const payoutResult = await db
            .collection<Character>("characters")
            .updateOne({ _id: character._id }, payoutUpdate);
          if (payoutResult.matchedCount === 0) {
            throw notFound("Character not found");
          }

          await db
            .collection("bonds")
            .updateOne(
              { _id: bond._id },
              buildHolderCleanupUpdate("characterId", character._id, now)
            );
        } catch (error) {
          await rollbackClaim();
          throw error;
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
        pricePerUnit: bond.marketPrice,
      },
    });

    return NextResponse.json({
      success: true,
      unitsSold: units,
      proceeds: Math.round(proceedsLocal * 100) / 100,
      proceedsCurrency: bondCurrency,
      pricePerUnit: Math.round(BOND_UNIT_FACE_VALUE * bond.marketPrice * 100) / 100,
      seller: "character",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
