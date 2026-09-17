import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { submitOfferSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { assertCeoTradeNotBlocked } from "@/lib/corporations/commands/privatization/openVoteGuard";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  estimateCorpWalletSpend,
  getCorpFxRate,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  buildShareOfferSubmitOfferId,
  executeShareOfferSubmitFlow,
  getStoredShareOfferSubmitResponse,
  recoverShareOfferSubmitByKey,
  type ShareOfferSubmitPlan,
} from "@/lib/corporations/commands/shareTrading/shareOfferSpend";
import { personalBalanceField } from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  Character,
  Corporation,
  Notification,
  ShareListing,
  ShareOffer,
} from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { assertCeoAcquisitionWithinCap } from "@/lib/corporations/ceoShareAcquisitionCap";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";

/** Maps keyed-flow claim failures onto the legacy 409 surface. */
function mapSubmitKeyError(error: unknown): NextResponse {
  if (error instanceof MoneyFlowTerminalError) {
    return NextResponse.json(
      { error: "Offer submission already settled; start a new attempt with a new key." },
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

async function runSubmitKeyRecovery(
  db: Awaited<ReturnType<typeof getDb>>,
  submitKey: string
): Promise<NextResponse> {
  try {
    const recovered = await recoverShareOfferSubmitByKey(db, submitKey);
    if (!recovered.ok) {
      return NextResponse.json({ error: recovered.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, ...recovered.body });
  } catch (error) {
    return mapSubmitKeyError(error);
  }
}

interface RouteParams {
  params: Promise<{ id: string; listingId: string }>;
}

/**
 * POST /api/corporations/[id]/shares/listings/[listingId]/offers
 * Submit a purchase offer on an open listing. Escrow is charged immediately.
 * Price must be 50%–200% of listing.marketPriceAtCreation.
 * Auth: requireBasicAuth — any logged-in user except the seller
 * Errors: 400 (invalid price, expired, own listing), 403 (national corp), 404 (listing not found)
 */
export async function submitShareOffer(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Crash-safe submit (issue #1672): the escrow debit, the offer insert,
    // and the corp-branch FX spread run as keyed idempotent steps.
    // `Idempotency-Key` replays the stored outcome without moving money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const { id, listingId } = await params;
    const parsed = await parseJsonBody(request, submitOfferSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { shares, pricePerShare, offerAsCorporation } = parsed.data;
    const db = await getDb();

    // Same-key retry: the first attempt already validated, so reconcile
    // through the stored plan instead of re-running the guards (which
    // post-debit reads would fail). Runs before the action/turn guards so
    // crash recovery converges even while fresh submits are blocked.
    if (headerKey !== null) {
      const prior = await getStoredShareOfferSubmitResponse(db, headerKey);
      if (prior) {
        return runSubmitKeyRecovery(db, headerKey);
      }
    }

    const submitKey = headerKey ?? randomUUID();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const turnGuard = await rejectDuringTurn(db);
    if (turnGuard) return turnGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    if (!ObjectId.isValid(listingId)) {
      return NextResponse.json({ error: "Invalid listing ID" }, { status: 400 });
    }

    const listing = await db
      .collection<ShareListing>("shareListings")
      .findOne({ _id: new ObjectId(listingId) });

    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (!listing.corporationId.equals(corporation._id)) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    if (listing.status !== "open")
      return NextResponse.json({ error: "Listing is not open" }, { status: 400 });
    // Turn-first expiry guard (matches the turn processor) with a Date fallback
    // for legacy listings — so offers can't be submitted to a turn-expired
    // listing during a cron lag before the processor closes it.
    const listingExpired =
      typeof listing.expiresAtTurn === "number"
        ? (await getCurrentTurn(db)) >= listing.expiresAtTurn
        : new Date() >= listing.expiresAt;
    if (listingExpired) return NextResponse.json({ error: "Listing has expired" }, { status: 400 });

    // Fetch listing corp early so price-bound error messages use the correct currency symbol.
    // pricePerShare and marketPriceAtCreation are stored in the corp's liquidCurrencyCode (v0.2.6).
    const listingCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: listing.corporationId });
    const listingCorpSym =
      CURRENCY_SYMBOLS[(listingCorp?.liquidCurrencyCode ?? "USD") as CurrencyCode] ?? "₳";

    // Price bounds: 50%–200% of market price at listing creation
    const priceFloor = listing.marketPriceAtCreation * 0.5;
    const priceCeiling = listing.marketPriceAtCreation * 2.0;
    if (pricePerShare < priceFloor || pricePerShare > priceCeiling) {
      return NextResponse.json(
        {
          error: `Offer must be between ${listingCorpSym}${priceFloor.toFixed(4)} and ${listingCorpSym}${priceCeiling.toFixed(4)} per share`,
        },
        { status: 400 }
      );
    }

    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

    const tradeLock = await assertCeoTradeNotBlocked(db, corporation, character._id);
    if (tradeLock.blocked) {
      return NextResponse.json({ error: tradeLock.error }, { status: tradeLock.status });
    }

    // Cannot offer on your own listing
    if (listing.sellerCharacterId.toString() === character._id.toString()) {
      return NextResponse.json({ error: "Cannot offer on your own listing" }, { status: 400 });
    }

    // One pending offer per buyer per listing
    const existingOffer = await db
      .collection<ShareOffer>("shareOffers")
      .findOne({ listingId: listing._id, buyerCharacterId: character._id, status: "pending" });
    if (existingOffer) {
      return NextResponse.json(
        { error: "You already have a pending offer on this listing" },
        { status: 400 }
      );
    }

    const now = new Date();
    const currentTurn = await getCurrentTurn(db);

    // CEO self-acquisition cap: a personal buy offer by the corp's own CEO counts
    // against the 10%/120-turn window (open offers are tallied by the guard).
    if (!offerAsCorporation) {
      const ceoCap = await assertCeoAcquisitionWithinCap(
        db,
        corporation,
        character._id,
        "characterId",
        shares,
        currentTurn
      );
      if (ceoCap) return NextResponse.json({ error: ceoCap.error }, { status: ceoCap.status });
    }
    // pricePerShare and listing.marketPriceAtCreation are in the target corp's
    // liquidCurrencyCode (v0.2.6). Store escrowAmount in the same local unit
    // (Option B) so accept-time proceeds/refund math and the turn-level
    // expiry refund are all FX-stable. Wallet deduction uses ₳ as the hop.
    // listingCorp was fetched above for the price-bound currency display.
    const listingCorpFxRate = await getCorpFxRate(db, listingCorp ?? {});
    const escrowAmount = Math.round(shares * pricePerShare * 100) / 100;
    const escrowAnchor = corpLiquidCapitalToAnchor(
      escrowAmount,
      listingCorp ?? {},
      listingCorpFxRate
    );
    const forexEnabled = await isForexEnabled();

    // Cross-currency FX spread a corp pays escrowing a foreign offer — consumed at
    // placement (cancel/reject refunds only escrowAmount, not the markup), so
    // routed to the CB system before returning. Set inside the corp branch.
    let offerFxSpread: { fee: number; from: CurrencyCode; to: CurrencyCode } | null = null;
    let submitBody: { escrowAmount: number; spreadPaid: number };

    if (offerAsCorporation) {
      const placerCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
      if (!placerCorp) {
        return NextResponse.json(
          { error: "You must be an active CEO to offer on behalf of a corporation" },
          { status: 403 }
        );
      }
      if (placerCorp.countryOwnerId) {
        return NextResponse.json(
          { error: "National corporations cannot hold equity" },
          { status: 400 }
        );
      }
      // Cannot offer on a listing created by the same corporation
      if (listing.sellerCorporationId && placerCorp._id.equals(listing.sellerCorporationId)) {
        return NextResponse.json(
          { error: "Cannot offer on your own corporation's listing" },
          { status: 400 }
        );
      }
      const placerCurrency = (resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD") as CurrencyCode;
      const targetCurrency = (resolveCorpLiquidCurrencyCode(listingCorp) ?? "USD") as CurrencyCode;
      const placerFxRate = await getCorpFxRate(db, placerCorp);
      const fxRates = await loadFxRatesRecord(db);
      const escrowEstimate = estimateCorpWalletSpend({
        requiredAmount: escrowAmount,
        availableBalance: placerCorp.liquidCapital ?? 0,
        fromCurrency: placerCurrency,
        toCurrency: targetCurrency,
        rates: fxRates,
      });
      if (!escrowEstimate) {
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      const escrowInPlacerCapital =
        placerCurrency !== targetCurrency
          ? escrowEstimate.spendAmount
          : anchorToCorpLiquidCapital(escrowAnchor, placerCorp, placerFxRate);
      if (placerCurrency !== targetCurrency) {
        offerFxSpread = { fee: escrowEstimate.spreadFee, from: placerCurrency, to: targetCurrency };
      }

      // Keyed escrow settlement (issue #1672): the guarded debit, the
      // deterministic offer insert, and the FX spread run as idempotent
      // steps under one receipt. The legacy insufficient-funds message is
      // pinned here so guard failures keep the byte-identical surface.
      const placerSym = CURRENCY_SYMBOLS[placerCurrency] ?? "$";
      const targetSym = CURRENCY_SYMBOLS[targetCurrency] ?? "$";
      const needStr = escrowAmount.toLocaleString(undefined, { minimumFractionDigits: 2 });
      const adjustedStr = escrowInPlacerCapital.toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      const haveStr = (placerCorp.liquidCapital ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      const currencyNote =
        placerCurrency !== targetCurrency
          ? ` (${placerSym}${adjustedStr} ${placerCurrency} incl. FX, corp has ${placerSym}${haveStr} ${placerCurrency})`
          : `, corp has ${placerSym}${haveStr} ${placerCurrency}`;
      const spreadPaid = offerFxSpread != null ? Math.round(offerFxSpread.fee * 100) / 100 : 0;
      const corpPlan: ShareOfferSubmitPlan = {
        version: 1,
        submitKey,
        listingIdHex: listing._id.toHexString(),
        corpIdHex: listing.corporationId.toHexString(),
        buyerCharacterIdHex: character._id.toHexString(),
        buyerCorporationIdHex: placerCorp._id.toHexString(),
        shares,
        pricePerShare,
        escrowAmount,
        escrowDebit: {
          collection: "corporations",
          idHex: placerCorp._id.toHexString(),
          field: "liquidCapital",
          amount: escrowInPlacerCapital,
        },
        payerType: "corporation",
        payerIdHex: placerCorp._id.toHexString(),
        payerName: placerCorp.name,
        payerCurrencyCode: placerCurrency,
        insufficientError: `Insufficient corporation funds for escrow. Need ${targetSym}${needStr}${currencyNote}`,
        turn: currentTurn,
        nowIso: now.toISOString(),
        offerIdHex: buildShareOfferSubmitOfferId(submitKey).toHexString(),
        spread: offerFxSpread,
        response: { escrowAmount, spreadPaid },
      };
      let corpResult: Awaited<ReturnType<typeof executeShareOfferSubmitFlow>>;
      try {
        corpResult = await executeShareOfferSubmitFlow(db, corpPlan, { idempotencyKey: submitKey });
      } catch (error) {
        return mapSubmitKeyError(error);
      }
      if (!corpResult.ok) {
        return NextResponse.json({ error: corpResult.error }, { status: 400 });
      }
      submitBody = corpResult.body;
    } else {
      const homeCurrency = getHomeCurrency(character);
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
      const escrowInHome = escrowAnchor * charFxRate;

      // Keyed escrow settlement (issue #1672): the guarded debit and the
      // deterministic offer insert run as idempotent steps under one
      // receipt. Pre-fix used getPersonalBalance() against a cached doc +
      // non-atomic $inc; the keyed debit keeps the same `$gte` guard.
      const charPlan: ShareOfferSubmitPlan = {
        version: 1,
        submitKey,
        listingIdHex: listing._id.toHexString(),
        corpIdHex: listing.corporationId.toHexString(),
        buyerCharacterIdHex: character._id.toHexString(),
        buyerCorporationIdHex: null,
        shares,
        pricePerShare,
        escrowAmount,
        escrowDebit: {
          collection: "characters",
          idHex: character._id.toHexString(),
          field: personalBalanceField(homeCurrency, forexEnabled),
          amount: escrowInHome,
        },
        payerType: "character",
        payerIdHex: character._id.toHexString(),
        payerName: character.name,
        payerCurrencyCode: homeCurrency,
        insufficientError: "Insufficient funds for escrow",
        turn: currentTurn,
        nowIso: now.toISOString(),
        offerIdHex: buildShareOfferSubmitOfferId(submitKey).toHexString(),
        spread: null,
        response: { escrowAmount, spreadPaid: 0 },
      };
      let charResult: Awaited<ReturnType<typeof executeShareOfferSubmitFlow>>;
      try {
        charResult = await executeShareOfferSubmitFlow(db, charPlan, { idempotencyKey: submitKey });
      } catch (error) {
        return mapSubmitKeyError(error);
      }
      if (!charResult.ok) {
        return NextResponse.json({ error: charResult.error }, { status: 400 });
      }
      submitBody = charResult.body;
    }

    // Notify the seller
    void (async () => {
      const sellerChar = await db
        .collection<Character>("characters")
        .findOne({ _id: listing.sellerCharacterId }, { projection: { userId: 1 } });

      if (!sellerChar) return;

      await db.collection<Omit<Notification, "_id">>("notifications").insertOne({
        userId: sellerChar.userId,
        type: "share_listing_offer_received",
        title: "New offer on your share listing",
        message: `${character.name} offered ${listingCorpSym}${pricePerShare.toFixed(4)}/share for ${shares.toLocaleString()} shares of ${listingCorp?.name ?? "your corporation"}`,
        read: false,
        metadata: { listingId: listing._id.toString() },
        createdAt: now,
      } as Omit<Notification, "_id">);
    })().catch(() => undefined);

    // The corp-branch FX spread already routed as keyed steps inside the
    // flow (exactly once, not post-commit), so nothing routes here.
    return NextResponse.json({
      success: true,
      escrowAmount: submitBody.escrowAmount,
      spreadPaid: submitBody.spreadPaid,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
