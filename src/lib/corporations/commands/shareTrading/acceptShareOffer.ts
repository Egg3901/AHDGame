import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { acceptOfferSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { notifyHostileTakeoverThresholdIfEligible } from "@/lib/corporations/hostileTakeoverNotifications";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import {
  executeShareOfferAcceptFlow,
  getStoredShareOfferAcceptResponse,
  recoverShareOfferAcceptByKey,
  type ShareOfferAcceptPlan,
} from "@/lib/corporations/commands/shareTrading/shareOfferSpend";
import { personalBalanceField } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import type {
  Character,
  Corporation,
  Notification,
  ShareListing,
  ShareOffer,
} from "@/lib/db/types";

/** Maps keyed-flow claim failures onto the legacy 409 surface. */
function mapAcceptKeyError(error: unknown): NextResponse {
  if (error instanceof MoneyFlowTerminalError) {
    return NextResponse.json(
      { error: "Acceptance already settled; start a new attempt with a new key." },
      { status: 409 }
    );
  }
  if (error instanceof MoneyFlowKeyConflictError) {
    return NextResponse.json(
      { error: "Idempotency key was reused for a different transfer." },
      { status: 409 }
    );
  }
  throw error;
}

async function runAcceptKeyRecovery(
  db: Awaited<ReturnType<typeof getDb>>,
  acceptKey: string
): Promise<NextResponse> {
  try {
    const recovered = await recoverShareOfferAcceptByKey(db, acceptKey);
    if (!recovered.ok) {
      return NextResponse.json({ error: recovered.error }, { status: recovered.status });
    }
    return NextResponse.json({ success: true, ...recovered.body });
  } catch (error) {
    return mapAcceptKeyError(error);
  }
}

interface RouteParams {
  params: Promise<{ id: string; listingId: string; offerId: string }>;
}

/**
 * POST /api/corporations/[id]/shares/listings/[listingId]/offers/[offerId]/accept
 * Seller accepts an offer — full or partial. Transfers shares; refunds unaccepted escrow.
 * Auth: requireBasicAuth — listing seller only
 * Errors: 400 (not open/pending/expired, sharesToAccept > max), 403 (not seller), 404 (not found)
 */
export async function acceptShareOffer(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, listingId, offerId } = await params;
    const parsed = await parseJsonBody(request, acceptOfferSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { sharesToAccept } = parsed.data;
    const db = await getDb();

    // Crash-safe accept (issue #1672): the offer/listing claims, the buyer
    // share credit, the seller proceeds, and the partial refund run as
    // keyed idempotent steps. `Idempotency-Key` replays the stored outcome
    // without moving money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    // Same-key retry: the first attempt already validated, so reconcile
    // through the stored plan instead of re-running the guards. Runs before
    // the action/turn guards so crash recovery converges even while fresh
    // accepts are blocked.
    if (headerKey !== null) {
      const prior = await getStoredShareOfferAcceptResponse(db, headerKey);
      if (prior) {
        return runAcceptKeyRecovery(db, headerKey);
      }
    }

    const acceptKey = headerKey ?? randomUUID();
    const forexEnabled = await isForexEnabled();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (!ObjectId.isValid(listingId) || !ObjectId.isValid(offerId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const [listing, offer] = await Promise.all([
      db.collection<ShareListing>("shareListings").findOne({ _id: new ObjectId(listingId) }),
      db.collection<ShareOffer>("shareOffers").findOne({ _id: new ObjectId(offerId) }),
    ]);

    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (!listing.corporationId.equals(corporation._id)) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    if (listing.status !== "open")
      return NextResponse.json({ error: "Listing is not open" }, { status: 400 });
    if (offer.status !== "pending")
      return NextResponse.json({ error: "Offer is not pending" }, { status: 400 });
    if (!offer.listingId.equals(listing._id))
      return NextResponse.json({ error: "Offer does not belong to this listing" }, { status: 400 });
    // Turn-first expiry guard (matches the turn processor) with a Date fallback
    // for legacy listings — so a turn-expired listing can't accept offers during
    // a cron lag before the processor closes it.
    const listingExpired =
      typeof listing.expiresAtTurn === "number"
        ? (await getCurrentTurn(db)) >= listing.expiresAtTurn
        : new Date() >= listing.expiresAt;
    if (listingExpired) return NextResponse.json({ error: "Listing has expired" }, { status: 400 });

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
    }

    if (listing.sellerCharacterId.toString() !== character._id.toString()) {
      return NextResponse.json({ error: "Only the seller can accept offers" }, { status: 403 });
    }

    const maxAcceptable = Math.min(offer.shares, listing.sharesRemaining);
    if (sharesToAccept > maxAcceptable) {
      return NextResponse.json(
        { error: `Cannot accept more than ${maxAcceptable.toLocaleString()} shares` },
        { status: 400 }
      );
    }

    const now = new Date();
    const currentTurn = await getCurrentTurn(db);
    // offer.pricePerShare and offer.escrowAmount are both stored in the listing
    // corp's liquidCurrencyCode (Option B). proceeds + refund always equals
    // offer.escrowAmount exactly in local terms, so we compute both in local
    // and then hop through ₳ for the seller-credit / buyer-refund wallet math.
    const listingCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: listing.corporationId });
    const listingCorpFxRate = await getCorpFxRate(db, listingCorp ?? {});
    const proceedsLocal = sharesToAccept * offer.pricePerShare;
    const refundLocal = (offer.shares - sharesToAccept) * offer.pricePerShare;
    const proceeds =
      Math.round(
        corpLiquidCapitalToAnchor(proceedsLocal, listingCorp ?? {}, listingCorpFxRate) * 100
      ) / 100;
    const refund =
      Math.round(
        corpLiquidCapitalToAnchor(refundLocal, listingCorp ?? {}, listingCorpFxRate) * 100
      ) / 100;
    const sellerChar = !listing.sellerCorporationId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: listing.sellerCharacterId }, { projection: { countryId: 1, name: 1 } })
      : null;
    const sellerCurrency = sellerChar ? getHomeCurrency(sellerChar) : "USD";
    let sellerFxRate = 1.0;
    if (!listing.sellerCorporationId && forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, sellerCurrency);
      if (!fxResult.ok) {
        return NextResponse.json(
          { error: "Exchange rate unavailable for seller" },
          { status: 503 }
        );
      }
      sellerFxRate = fxResult.rate;
    }

    const buyerCharForRefund =
      refund > 0 && !offer.buyerCorporationId
        ? await db
            .collection<Character>("characters")
            .findOne({ _id: offer.buyerCharacterId }, { projection: { countryId: 1, name: 1 } })
        : null;
    const buyerCurrency = buyerCharForRefund ? getHomeCurrency(buyerCharForRefund) : "USD";
    let buyerFxRate = 1.0;
    if (refund > 0 && !offer.buyerCorporationId && forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, buyerCurrency);
      if (!fxResult.ok) {
        return NextResponse.json({ error: "Exchange rate unavailable for buyer" }, { status: 503 });
      }
      buyerFxRate = fxResult.rate;
    }

    // Keyed acceptance settlement (issue #1672): the offer/listing claims,
    // the buyer share credit, the seller proceeds, and the partial refund
    // run as idempotent steps under one receipt. Every figure below is
    // pinned here so recovery replays stored amounts instead of re-reading
    // post-accept state.
    const buyerIsCorp = !!offer.buyerCorporationId;
    const buyerCorpDoc = buyerIsCorp
      ? await db.collection<Corporation>("corporations").findOne({ _id: offer.buyerCorporationId! })
      : null;
    const buyerCorpFxRate = buyerIsCorp ? await getCorpFxRate(db, buyerCorpDoc ?? {}) : 1.0;
    const buyerCurrencyCode = buyerIsCorp
      ? ((resolveCorpLiquidCurrencyCode(buyerCorpDoc ?? {}) ?? "USD") as CurrencyCode)
      : (buyerCurrency as CurrencyCode);
    const buyerName = buyerIsCorp
      ? (buyerCorpDoc?.name ?? "Unknown corporation")
      : (buyerCharForRefund?.name ?? "Unknown character");
    const refundInBuyerDenom = buyerIsCorp
      ? anchorToCorpLiquidCapital(refund, buyerCorpDoc ?? {}, buyerCorpFxRate)
      : refund * buyerFxRate;

    const sellerCorpDoc = listing.sellerCorporationId
      ? await db
          .collection<Corporation>("corporations")
          .findOne({ _id: listing.sellerCorporationId })
      : null;
    const sellerCorpFxRate = listing.sellerCorporationId
      ? await getCorpFxRate(db, sellerCorpDoc ?? {})
      : 1.0;
    const sellerCurrencyCode = listing.sellerCorporationId
      ? ((resolveCorpLiquidCurrencyCode(sellerCorpDoc ?? {}) ?? "USD") as CurrencyCode)
      : (sellerCurrency as CurrencyCode);
    const sellerName = listing.sellerCorporationId
      ? (sellerCorpDoc?.name ?? "Unknown corporation")
      : (sellerChar?.name ?? character.name);
    const proceedsInSellerDenom = listing.sellerCorporationId
      ? anchorToCorpLiquidCapital(proceeds, sellerCorpDoc ?? {}, sellerCorpFxRate)
      : proceeds * sellerFxRate;

    const acceptPlan: ShareOfferAcceptPlan = {
      version: 1,
      acceptKey,
      listingIdHex: listing._id.toHexString(),
      offerIdHex: offer._id.toHexString(),
      corpIdHex: listing.corporationId.toHexString(),
      sharesToAccept,
      sharesOffered: offer.shares,
      pricePerShare: offer.pricePerShare,
      turn: currentTurn,
      nowIso: now.toISOString(),
      forexEnabled,
      buyerCredit: {
        field: buyerIsCorp ? "corporationId" : "characterId",
        idHex: (buyerIsCorp ? offer.buyerCorporationId! : offer.buyerCharacterId).toHexString(),
        pricePerShare: offer.pricePerShare,
      },
      buyerIsCorp,
      buyerIdHex: (buyerIsCorp ? offer.buyerCorporationId! : offer.buyerCharacterId).toHexString(),
      buyerName,
      buyerCurrencyCode,
      proceedsLeg: {
        collection: listing.sellerCorporationId ? "corporations" : "characters",
        idHex: (listing.sellerCorporationId ?? listing.sellerCharacterId).toHexString(),
        field: listing.sellerCorporationId
          ? "liquidCapital"
          : personalBalanceField(sellerCurrency, forexEnabled),
        amount: proceedsInSellerDenom,
      },
      sellerType: listing.sellerCorporationId ? "corporation" : "character",
      sellerIdHex: (listing.sellerCorporationId ?? listing.sellerCharacterId).toHexString(),
      sellerName,
      sellerCurrencyCode,
      refundLeg:
        refund > 0
          ? {
              collection: buyerIsCorp ? "corporations" : "characters",
              idHex: (buyerIsCorp
                ? offer.buyerCorporationId!
                : offer.buyerCharacterId
              ).toHexString(),
              field: buyerIsCorp
                ? "liquidCapital"
                : personalBalanceField(buyerCurrency, forexEnabled),
              amount: refundInBuyerDenom,
            }
          : null,
      proceeds,
      refund,
      listingCorpName: listingCorp?.name ?? "unknown",
    };
    let acceptResult: Awaited<ReturnType<typeof executeShareOfferAcceptFlow>>;
    try {
      acceptResult = await executeShareOfferAcceptFlow(db, acceptPlan, {
        idempotencyKey: acceptKey,
      });
    } catch (error) {
      return mapAcceptKeyError(error);
    }
    if (!acceptResult.ok) {
      return NextResponse.json({ error: acceptResult.error }, { status: acceptResult.status });
    }
    const acceptBody = acceptResult.body;

    // Notify buyer
    const buyerChar = await db
      .collection<Character>("characters")
      .findOne({ _id: offer.buyerCharacterId }, { projection: { userId: 1 } });

    if (buyerChar) {
      const listingCorpSym =
        CURRENCY_SYMBOLS[(listingCorp?.liquidCurrencyCode ?? "USD") as CurrencyCode] ?? "₳";
      void db
        .collection<Omit<Notification, "_id">>("notifications")
        .insertOne({
          userId: buyerChar.userId,
          type: "share_offer_accepted",
          title: "Your share offer was accepted",
          message: `${sharesToAccept.toLocaleString()} shares of ${listingCorp?.name ?? "unknown"} at ${listingCorpSym}${offer.pricePerShare.toFixed(4)}/share`,
          read: false,
          metadata: { listingId: listing._id.toString(), offerId: offer._id.toString() },
          createdAt: now,
        } as Omit<Notification, "_id">)
        .catch(() => undefined);
    }

    void (async () => {
      // Resolve party names for the history row. Listing seller is always a
      // character or corp (per sellerCorporationId/sellerCharacterId schema),
      // buyer may be either too.
      let historyFrom: ShareTradeParty;
      if (listing.sellerCorporationId) {
        const sellerCorp = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: listing.sellerCorporationId }, { projection: { name: 1 } });
        historyFrom = {
          corporationId: listing.sellerCorporationId,
          name: sellerCorp?.name ?? "Unknown corporation",
        };
      } else {
        const sellerCharDoc = await db
          .collection<Character>("characters")
          .findOne({ _id: listing.sellerCharacterId }, { projection: { name: 1 } });
        historyFrom = {
          characterId: listing.sellerCharacterId,
          name: sellerCharDoc?.name ?? "Unknown character",
        };
      }
      let historyTo: ShareTradeParty;
      if (offer.buyerCorporationId) {
        const buyerCorpDoc = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: offer.buyerCorporationId }, { projection: { name: 1 } });
        historyTo = {
          corporationId: offer.buyerCorporationId,
          name: buyerCorpDoc?.name ?? "Unknown corporation",
        };
      } else {
        const buyerCharDoc = await db
          .collection<Character>("characters")
          .findOne({ _id: offer.buyerCharacterId }, { projection: { name: 1 } });
        historyTo = {
          characterId: offer.buyerCharacterId,
          name: buyerCharDoc?.name ?? "Unknown character",
        };
      }
      // offer.pricePerShare is stored in the listing corp's liquidCurrencyCode
      // (Option B). Convert to ₳ for the audit row — `proceeds` above is already
      // the ₳-anchored total, so per-share ₳ = proceeds / sharesToAccept.
      void recordShareTrade(db, {
        corporationId: listing.corporationId,
        kind: "listing_fill",
        turn: currentTurn,
        shares: sharesToAccept,
        pricePerShareAnchor: proceeds / sharesToAccept,
        from: historyFrom,
        to: historyTo,
        corpCurrencyCode: listingCorp?.liquidCurrencyCode,
      });
    })().catch(() => undefined);

    void notifyHostileTakeoverThresholdIfEligible(db, listing.corporationId);

    return NextResponse.json({
      success: true,
      sharesTransferred: acceptBody.sharesTransferred,
      proceeds: acceptBody.proceeds,
      refundedToOffer: acceptBody.refundedToOffer,
      listingSharesRemaining: acceptBody.listingSharesRemaining,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
