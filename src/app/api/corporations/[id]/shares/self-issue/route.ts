import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { selfIssueSharesSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { subsidiaryIssuanceBlockReason } from "@/lib/corporations/subsidiaries/issuanceGuard";
import { CEO_SELF_ISSUANCE_PREMIUM, MAX_SELF_ISSUANCE_PERCENT } from "@/lib/constants/corporations";
import type {
  Character,
  Corporation,
  GameState,
  ShareListing,
  ShareOrder,
  User,
} from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import type { CorporationVote } from "@/lib/db/types/corporationVote";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getHomeCurrency,
  loadCharacterFxRate,
  type PersonalWealthHolder,
} from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
} from "@/lib/currency/corporationCapital";
import { autoConvertForPurchase } from "@/lib/currency/autoConvert";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { computeAccountedShares } from "@/lib/corporations/shareInvariant";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
  atomicallyDebitImperialCash,
  refundImperialCash,
} from "@/lib/financialTxLog/atomicCashGuard";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function restoreIssuanceCooldown(
  db: Awaited<ReturnType<typeof getDb>>,
  corporation: Corporation
) {
  const updatedAt = new Date();

  if (corporation.lastShareIssuance) {
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $set: {
          lastShareIssuance: corporation.lastShareIssuance,
          updatedAt,
        },
      }
    );
    return;
  }

  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporation._id },
    {
      $unset: { lastShareIssuance: "" },
      $set: { updatedAt },
    }
  );
}

/**
 * POST /api/corporations/[id]/shares/self-issue
 * CEO buys newly issued shares at 15% above the current execution price.
 * Money comes from CEO's cashOnHand and goes into corporation's liquidCapital.
 * New shares are added to the CEO's shareholder entry (dilutes other shareholders).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, selfIssueSharesSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { shares } = parsed.data;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const subBlock = await subsidiaryIssuanceBlockReason(corporation);
    if (subBlock) return NextResponse.json({ error: subBlock }, { status: 403 });

    const openShareholderVote = await db
      .collection<CorporationVote>("corporationVotes")
      .findOne({ corporationId: corporation._id, status: "open" }, { projection: { _id: 1 } });
    if (openShareholderVote) {
      return NextResponse.json(
        { error: "Cannot issue shares while a shareholder vote is open" },
        { status: 400 }
      );
    }

    // Cap self-issuance at MAX_SELF_ISSUANCE_PERCENT of outstanding shares
    const currentShares = corporation.totalShares ?? 10_000_000;
    const maxShares = Math.floor((MAX_SELF_ISSUANCE_PERCENT / 100) * currentShares);
    if (shares > maxShares) {
      return NextResponse.json(
        {
          error: `Cannot self-issue more than ${MAX_SELF_ISSUANCE_PERCENT}% of outstanding shares (${maxShares.toLocaleString()} shares max)`,
        },
        { status: 400 }
      );
    }

    const executionPrice = resolveShareExecutionPrice(corporation);
    const pricePerShare = executionPrice * (1 + CEO_SELF_ISSUANCE_PREMIUM);
    // sharePrice is stored in the corp's liquidCurrencyCode (v0.2.6); totalCost
    // in the corp's local currency, which we also normalize to ₳ (`totalCost`)
    // for the downstream home-currency deduction math.
    const totalCostLocal = shares * pricePerShare;
    const corpFxRate = await getCorpFxRate(db, corporation);
    const totalCost = corpLiquidCapitalToAnchor(totalCostLocal, corporation, corpFxRate);

    // Resolve character type
    const userDoc = await db
      .collection<User>("users")
      .findOne({ _id: new ObjectId(auth.user.userId) });
    const isImperialMode =
      userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

    let ceoCharId: ObjectId;
    let ceoCharName: string;
    let homeCurrency: import("@/lib/constants/currencies").CurrencyCode;
    let collectionName: "characters" | "imperialCharacters";
    let shareholderField: "shareholders.characterId" | "shareholders.imperialCharacterId";
    let shareholderEntry: Record<string, unknown>;

    const forexEnabled = await isForexEnabled();

    if (isImperialMode) {
      const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
        _id: userDoc!.activeImperialCharacterId!,
        userId: new ObjectId(auth.user.userId),
      });
      if (!imperial) {
        return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
      }
      ceoCharId = imperial._id;
      ceoCharName = imperial.name;
      collectionName = "imperialCharacters";
      shareholderField = "shareholders.imperialCharacterId";
      shareholderEntry = { imperialCharacterId: imperial._id, shares };
      homeCurrency = getHomeCurrency(imperial);
    } else {
      const characterQuery = userDoc?.activeCharacterId
        ? { _id: userDoc.activeCharacterId, userId: new ObjectId(auth.user.userId) }
        : { userId: new ObjectId(auth.user.userId) };
      const character = await db.collection<Character>("characters").findOne(characterQuery);
      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }
      ceoCharId = character._id;
      ceoCharName = character.name;
      collectionName = "characters";
      shareholderField = "shareholders.characterId";
      shareholderEntry = { characterId: character._id, shares };
      homeCurrency = getHomeCurrency(character);
    }

    // Cost is in ₳; convert to CEO's home currency before deducting.
    let charFxRate = 1.0;
    if (forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, homeCurrency);
      if (!fxResult.ok) {
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      charFxRate = fxResult.rate;
    }
    const totalCostInHome = forexEnabled ? totalCost * charFxRate : totalCost;

    // Load fresh document for balance check and optional multi-currency consolidation
    let ceoDoc = await db.collection(collectionName).findOne({ _id: ceoCharId });

    if (forexEnabled && ceoDoc) {
      const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      const convertResult = await autoConvertForPurchase(db, {
        character: ceoDoc as PersonalWealthHolder & { _id: ObjectId },
        requiredCurrency: homeCurrency,
        requiredAmount: totalCostInHome,
        turn: gs?.currentTurn ?? 0,
        forexEnabled,
        collectionName,
      });
      if (!convertResult.success) {
        return NextResponse.json({ error: convertResult.error }, { status: 400 });
      }
      ceoDoc = await db.collection(collectionName).findOne({ _id: ceoCharId });
    }

    if (!ceoDoc) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const now = new Date();
    const ISSUANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

    const cooldownQuery = corporation.lastShareIssuance
      ? {
          _id: corporation._id,
          $or: [
            { lastShareIssuance: null },
            {
              lastShareIssuance: {
                $lte: new Date(Date.now() - ISSUANCE_COOLDOWN_MS),
              },
            },
          ],
        }
      : { _id: corporation._id };

    const totalCostInCorpCapital = anchorToCorpLiquidCapital(totalCost, corporation, corpFxRate);

    const cooldownResult = await db
      .collection<Corporation>("corporations")
      .findOneAndUpdate(
        cooldownQuery as never,
        { $set: { lastShareIssuance: now, updatedAt: now } },
        { returnDocument: "after" }
      );

    if (!cooldownResult) {
      const elapsed = corporation.lastShareIssuance
        ? Date.now() - new Date(corporation.lastShareIssuance).getTime()
        : 0;
      const remaining = Math.ceil((ISSUANCE_COOLDOWN_MS - elapsed) / 1000 / 60 / 60);
      return NextResponse.json(
        {
          error: `Share issuance is limited to once per 24 hours. Try again in ${remaining}h.`,
        },
        { status: 429 }
      );
    }

    // Atomic balance-gated debit on the CEO's wallet. Replaces the read-then-
    // write pattern that allowed concurrent self-issue requests to over-deduct
    // (or, worse, to leave shares + corp liquidCapital credited while the CEO's
    // cash silently failed to deduct — the same shape as the bond-buy bug).
    const debitResult =
      collectionName === "imperialCharacters"
        ? await atomicallyDebitImperialCash(
            db,
            ceoCharId,
            homeCurrency,
            totalCostInHome,
            forexEnabled
          )
        : await atomicallyDebitCharacterCash(
            db,
            ceoCharId,
            homeCurrency,
            totalCostInHome,
            forexEnabled
          );

    if (!debitResult.ok) {
      // Cooldown was already taken — best-effort revert so a failed buy
      // doesn't lock the CEO out of self-issuance for 24h. If there was a
      // prior issuance timestamp, restore it; otherwise unset the field.
      await restoreIssuanceCooldown(db, corporation);
      return NextResponse.json(
        {
          error: `Insufficient personal funds. Need ${totalCostInHome.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${homeCurrency}.`,
        },
        { status: 400 }
      );
    }

    let issuanceCommitted = false;
    try {
      // Credit shares to CEO's shareholder entry AND increment totalShares in one atomic write.
      const incResult = await db.collection<Corporation>("corporations").updateOne(
        { _id: corporation._id, [shareholderField]: ceoCharId },
        {
          $inc: {
            "shareholders.$.shares": shares,
            totalShares: shares,
            liquidCapital: totalCostInCorpCapital,
            shareIssuanceProceeds: totalCostInCorpCapital,
          },
          $set: { updatedAt: now },
        }
      );

      if (incResult.matchedCount === 0) {
        await db.collection<Corporation>("corporations").updateOne(
          { _id: corporation._id },
          {
            $push: { shareholders: shareholderEntry } as never,
            $inc: {
              totalShares: shares,
              liquidCapital: totalCostInCorpCapital,
              shareIssuanceProceeds: totalCostInCorpCapital,
            },
            $set: { updatedAt: now },
          }
        );
      }
      issuanceCommitted = true;
    } catch (err) {
      if (collectionName === "imperialCharacters") {
        await refundImperialCash(db, ceoCharId, homeCurrency, totalCostInHome, forexEnabled);
      } else {
        await refundCharacterCash(db, ceoCharId, homeCurrency, totalCostInHome, forexEnabled);
      }
      await restoreIssuanceCooldown(db, corporation);
      throw err;
    }
    void issuanceCommitted;

    // Re-read the fresh corp to both report the true post-op totalShares and
    // verify the share invariant: totalShares must still equal
    // shareholders + publicFloat + open listings + open corp sell orders.
    // If it drifts, shares have silently been added or lost — report to
    // Sentry so we can trace the next "shares disappeared" claim.
    const freshCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: corporation._id });
    const newTotalShares =
      freshCorp?.totalShares ?? (corporation.totalShares ?? 10_000_000) + shares;

    if (freshCorp) {
      const [openListings, openCorpSellOrders] = await Promise.all([
        db
          .collection<ShareListing>("shareListings")
          .find({ corporationId: corporation._id, status: "open" })
          .toArray(),
        db
          .collection<ShareOrder>("shareOrders")
          .find({
            corporationId: corporation._id,
            type: "sell",
            status: "open",
            placerCorporationId: { $exists: true },
          })
          .toArray(),
      ]);
      const accounted = computeAccountedShares(freshCorp, openListings, openCorpSellOrders);
      if (accounted !== newTotalShares) {
        Sentry.captureMessage("self-issue share invariant drift", {
          level: "error",
          tags: { module: "corp/self-issue" },
          extra: {
            corporationId: corporation._id.toString(),
            ceoCharacterId: ceoCharId.toString(),
            issuedShares: shares,
            newTotalShares,
            accounted,
            drift: accounted - newTotalShares,
          },
        });
      }
    }

    // Audit trail: matches the issue/buy/sell routes. Without this row, a
    // player reporting "my CEO purchase deleted my shares" leaves no
    // evidence of the actual before/after movement. `to` points at the CEO
    // so the shares tab's history panel shows who received the issuance.
    const toParty = isImperialMode
      ? { imperialCharacterId: ceoCharId, name: ceoCharName }
      : { characterId: ceoCharId, name: ceoCharName };
    void recordShareTrade(db, {
      corporationId: corporation._id,
      kind: "issuance",
      turn: await getCurrentTurn(db),
      shares,
      pricePerShareAnchor: totalCost / shares,
      from: null,
      to: toParty,
      corpCurrencyCode: corporation.liquidCurrencyCode,
      note: `CEO self-issued ${shares.toLocaleString()} shares at ${(CEO_SELF_ISSUANCE_PREMIUM * 100).toFixed(0)}% premium`,
    });

    // Personal financial ledger: distinct stock_self_issue type now available
    // in the FinancialTxType union (Phase 2). Pre-fix this was emitted as
    // `stock_trade_buy` with `meta.selfIssuance: true`, which made it hard to
    // separate genuine market buys from CEO-paid issuances in admin queries.
    // The legacy meta flag is retained for downstream consumers still keying
    // on it until they migrate.
    void emitTx(db, {
      type: "stock_self_issue",
      turn: await getCurrentTurn(db),
      createdAt: now,
      subjectType: "character",
      subjectId: ceoCharId,
      subjectName: ceoCharName,
      amount: -totalCostInHome,
      balanceAfter: debitResult.newBalance,
      currencyCode: homeCurrency,
      counterpartyType: "corporation",
      counterpartyId: corporation._id,
      counterpartyName: corporation.name,
      meta: {
        corporationId: corporation._id.toString(),
        shares,
        pricePerShare,
        selfIssuance: true,
        premium: CEO_SELF_ISSUANCE_PREMIUM,
        imperial: collectionName === "imperialCharacters",
      },
    }).catch((error) => {
      Sentry.captureException(error, {
        tags: { module: "corp/self-issue/ledger" },
        extra: {
          corporationId: corporation._id.toString(),
          ceoCharacterId: ceoCharId.toString(),
          shares,
        },
      });
    });

    return NextResponse.json({
      success: true,
      sharesIssued: shares,
      totalCost: Math.round(totalCost * 100) / 100,
      pricePerShare: Math.round(pricePerShare * 10000) / 10000,
      premium: `${(CEO_SELF_ISSUANCE_PREMIUM * 100).toFixed(0)}%`,
      newTotalShares,
      proceedsToCorpration: Math.round(totalCost * 100) / 100,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
