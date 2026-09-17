import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { buyBondSchema } from "@/lib/api/schemas/bonds";
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, Character, Corporation, User } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { emitTx } from "@/lib/financialTxLog/emit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { autoConvertForPurchase, convertForExplicitPay } from "@/lib/currency/autoConvert";
import {
  anchorToCorpLiquidCapital,
  corpCapitalToAnchor,
  estimateCorpWalletSpend,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { GameState } from "@/lib/db/types";
import { wasCeoWithinTurns } from "@/lib/corporations/ceoHistory";
import { EX_CEO_BOND_PURCHASE_BLOCK_TURNS } from "@/lib/constants/bonds";
import { sovereignBondCapError } from "@/lib/bonds/holderCap";
import { loadBondQuote } from "@/lib/bonds/marketPool";
import { applyBondBuySpend, BOND_BUY_FUNDS, BOND_BUY_RESERVE } from "@/lib/bonds/bondBuySpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";

interface RouteParams {
  params: Promise<{ bondId: string }>;
}

/**
 * POST /api/bonds/[bondId]/buy
 * Buy bond units from the public float (AI market maker) at current market price.
 * Both players and corporations can buy bonds.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const user = auth.user;

    const { bondId } = await params;
    const parsed = await parseJsonBody(request, buyBondSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { units, payCurrency } = parsed.data;

    // Crash-safe settlement (issue #1672): a client retry with the same key
    // replays the stored purchase outcome instead of buying again.
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

    const turnDoc = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = turnDoc?.currentTurn ?? 0;

    if (bond.matured) {
      return NextResponse.json({ error: "Bond has already matured" }, { status: 400 });
    }

    if (bond.publicFloat < units) {
      return NextResponse.json(
        { error: `Only ${bond.publicFloat} units available` },
        { status: 400 }
      );
    }

    // Bond denomination — canonical key is `bond.currencyCode` (Task-18B); we
    // intentionally do not derive from the issuer corp's current country so that
    // admin-initiated cross-country HQ moves don't silently re-denominate
    // outstanding bonds (see docs/design/corporations.md §HQ Relocation).
    const bondCurrency: CurrencyCode = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : "USD")) as CurrencyCode;

    // Cost in the bond's LOCAL currency (`units × face × marketPrice` produces
    // `bond.currencyCode` post-Task-18B).
    // The pool sells at its ask: the rate-derived mid plus the dealer half
    // spread, shifted by the pool's cash position and sovereign appetite.
    const quote = await loadBondQuote(db, bond);
    const costLocal = units * quote.askPerUnit;

    // Check if buying as character or as corporation CEO (query param)
    const url = new URL(request.url);
    const buyAsCorp = url.searchParams.get("corporationId");

    const now = new Date();

    if (buyAsCorp) {
      // Buying as corporation
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: new ObjectId(buyAsCorp) });
      if (!corp) {
        return NextResponse.json({ error: "Corporation not found" }, { status: 404 });
      }
      if (corp.userId?.toString() !== user.userId) {
        return NextResponse.json(
          { error: "Only the CEO can buy bonds for a corporation" },
          { status: 403 }
        );
      }
      // Bond cost originates in `bondCurrency` but corp liquidity is in
      // `corp.liquidCurrencyCode` — normalize both through ₳ so the compare
      // and the deduction happen in matched units. Pre-fix path compared
      // LOCAL-bond cost directly against ₳-normalized corp capital (A19).
      const fxRates = await loadFxRatesRecord(db);
      const bondFxRate =
        fxRates[bondCurrency] && fxRates[bondCurrency]! > 0 ? fxRates[bondCurrency]! : 1;
      const costAnchor = corpCapitalToAnchor(costLocal, bondCurrency, bondFxRate);
      const corpCurrency = resolveCorpLiquidCurrencyCode(corp) ?? null;
      // Cannot buy own bonds (sovereign bonds have no corporationId — skip check)
      if (bond.corporationId && corp._id.toString() === bond.corporationId.toString()) {
        return NextResponse.json({ error: "Cannot buy your own bonds" }, { status: 400 });
      }

      // costInCorpCapital is computed via anchor normalization to handle
      // cross-currency buys (A19). The keyed flow below debits it with a
      // balance guard, so the compare-and-deduct is one atomic step.
      const corpPurchaseEstimate = estimateCorpWalletSpend({
        requiredAmount: costLocal,
        availableBalance: corp.liquidCapital ?? 0,
        fromCurrency: corpCurrency,
        toCurrency: bondCurrency,
        rates: fxRates,
      });
      if (!corpPurchaseEstimate) {
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      const costInCorpCapital =
        corpCurrency && corpCurrency !== bondCurrency
          ? corpPurchaseEstimate.spendAmount
          : anchorToCorpLiquidCapital(costAnchor, corp, fxRates[corpCurrency ?? bondCurrency] ?? 1);
      const corpCapErr = sovereignBondCapError(bond, "corporationId", corp._id, units);
      if (corpCapErr) {
        return NextResponse.json({ error: corpCapErr }, { status: 400 });
      }
      // Map a keyed-settlement failure back onto the historical surface: a
      // lost corp-funds race is the 400 insufficient-funds refusal, a lost
      // float race the 409 float refusal with the refreshed float. The
      // primitive already compensated any applied prefix, and the FX spread
      // routing runs inside the flow (same split as the legacy
      // `distributeConversionSpread`: reserve slice to the bond-currency CB
      // as a foreign reserve, forexRevenue to the corp's CB).
      try {
        await applyBondBuySpend(db, {
          bondId: bond._id,
          buyerKind: "corporation",
          buyerId: corp._id,
          units,
          debitAmount: costInCorpCapital,
          costLocal,
          bondCurrency,
          forexEnabled,
          corpCurrency: corpCurrency ?? bondCurrency,
          spreadFee:
            corpCurrency && corpCurrency !== bondCurrency ? corpPurchaseEstimate.spreadFee : 0,
          now,
          fingerprint: `bond-buy:${bond._id.toHexString()}:corporation:${corp._id.toHexString()}:${units}:${costLocal}:${costInCorpCapital}`,
          ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
        });
      } catch (error) {
        if (error instanceof MoneyFlowTerminalError) {
          return NextResponse.json(
            { error: "Purchase already settled; start a new attempt with a new key." },
            { status: 409 }
          );
        }
        if (error instanceof MoneyFlowKeyConflictError) {
          return NextResponse.json(
            { error: "Idempotency key was reused for a different purchase." },
            { status: 409 }
          );
        }
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith(BOND_BUY_FUNDS)) {
          const corpSym = CURRENCY_SYMBOLS[corpCurrency ?? "USD"] ?? "$";
          const corpNeed = corpPurchaseEstimate.requiredFromAmount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
          });
          const corpHave = (corp.liquidCapital ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
          });
          const corpNote =
            corpCurrency && corpCurrency !== bondCurrency
              ? ` (~${corpSym}${corpNeed} ${corpCurrency} incl. FX, corp has ${corpSym}${corpHave} ${corpCurrency})`
              : "";
          return NextResponse.json(
            {
              error: `Insufficient corporate funds. Need ${costLocal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${bondCurrency}${corpNote}`,
            },
            { status: 400 }
          );
        }
        if (message.startsWith(BOND_BUY_RESERVE)) {
          const latestBond = await db
            .collection<Bond>("bonds")
            .findOne({ _id: bond._id }, { projection: { publicFloat: 1 } });
          return NextResponse.json(
            { error: `Only ${latestBond?.publicFloat ?? 0} units available` },
            { status: 409 }
          );
        }
        throw error;
      }

      // Audit only: the keyed flow above already moved the money exactly
      // once. `emitTx` never throws, so a ledger failure cannot fail a
      // purchase whose money already moved.
      void emitTx(db, {
        type: "bond_purchase",
        turn: currentTurn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: corp._id,
        subjectName: corp.name,
        amount: -costInCorpCapital,
        currencyCode: resolveCorpLiquidCurrencyCode(corp) ?? "USD",
        counterpartyType: "system",
        counterpartyName: bond.issuerName ?? "Bond market",
        meta: {
          bondId: bond._id.toString(),
          units,
          pricePerUnit: quote.ask,
          // `currencyCode`/`amount` reflect the corp's actual lc movement
          // (corp's home currency, FX-converted from the bond's price).
          // `bondCurrency`/`bondAmount` carry the bond-side magnitude in
          // its own denomination so the cross-currency relationship is
          // explicit on the row — no need to mentally multiply
          // pricePerUnit × units × face to recover it.
          bondCurrency,
          bondAmount: -Math.round(costLocal * 100) / 100,
        },
      });

      return NextResponse.json({
        success: true,
        unitsBought: units,
        cost: Math.round(costLocal * 100) / 100,
        costCurrency: bondCurrency,
        pricePerUnit: quote.askPerUnit,
        buyer: "corporation",
        // Surface the FX spread the corp paid so the cash movement is explained
        // (no "money disappeared"). Zero for same-currency buys.
        spreadPaid:
          corpCurrency && corpCurrency !== bondCurrency
            ? Math.round(corpPurchaseEstimate.spreadFee * 100) / 100
            : 0,
        spreadCurrency: corpCurrency ?? bondCurrency,
      });
    } else {
      // Buying as character (regular or imperial)
      const userDoc = await db
        .collection<User>("users")
        .findOne({ _id: new ObjectId(user.userId) });
      const isImperialMode =
        userDoc?.activeCharacterType === "imperial" && !!userDoc?.activeImperialCharacterId;

      if (isImperialMode) {
        // ── Imperial character buy path ──────────────────────────────
        const imperial = await db.collection<ImperialCharacter>("imperialCharacters").findOne({
          _id: userDoc!.activeImperialCharacterId!,
          userId: new ObjectId(user.userId),
        });
        if (!imperial) {
          return NextResponse.json({ error: "Imperial character not found" }, { status: 404 });
        }

        // Block imperial CEO / pending-CEO / recent-former-CEO from buying their
        // own corp's bonds (CEO ⊥ bondholder invariant).
        const issuingCorp = await db
          .collection<Corporation>("corporations")
          .findOne(
            { _id: bond.corporationId },
            { projection: { ceoId: 1, ceoType: 1, pendingCeoCharacterId: 1, ceoHistory: 1 } }
          );
        if (
          (issuingCorp?.ceoType === "imperial" &&
            issuingCorp?.ceoId?.toString() === imperial._id.toString()) ||
          issuingCorp?.pendingCeoCharacterId?.toString() === imperial._id.toString()
        ) {
          return NextResponse.json(
            { error: "Cannot buy your own corporation's bonds" },
            { status: 400 }
          );
        }
        if (
          issuingCorp &&
          wasCeoWithinTurns(
            issuingCorp,
            imperial._id,
            currentTurn,
            EX_CEO_BOND_PURCHASE_BLOCK_TURNS
          )
        ) {
          return NextResponse.json(
            { error: "Previous CEOs cannot buy bonds in this corporation at this time." },
            { status: 400 }
          );
        }

        // Currency conversion for imperial characters
        if (forexEnabled) {
          const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
          if (payCurrency && payCurrency !== bondCurrency) {
            const convertResult = await convertForExplicitPay(db, {
              character: imperial,
              payCurrency,
              requiredCurrency: bondCurrency,
              requiredAmount: costLocal,
              turn: gs?.currentTurn ?? 0,
              forexEnabled,
              collectionName: "imperialCharacters",
            });
            if (!convertResult.success) {
              return NextResponse.json({ error: convertResult.error }, { status: 400 });
            }
          } else {
            const convertResult = await autoConvertForPurchase(db, {
              character: imperial,
              requiredCurrency: bondCurrency,
              requiredAmount: costLocal,
              turn: gs?.currentTurn ?? 0,
              forexEnabled,
              collectionName: "imperialCharacters",
            });
            if (convertResult.needed && !convertResult.success) {
              return NextResponse.json({ error: convertResult.error }, { status: 400 });
            }
          }
        }

        // convertForExplicitPay / autoConvert above may have already
        // consolidated FX into the bondCurrency; the keyed flow below still
        // debits with a balance guard, so the final spend is atomic.
        const imperialCapErr = sovereignBondCapError(
          bond,
          "imperialCharacterId",
          imperial._id,
          units
        );
        if (imperialCapErr) {
          return NextResponse.json({ error: imperialCapErr }, { status: 400 });
        }
        // Map a keyed-settlement failure back onto the historical surface: a
        // lost funds race is the 400 insufficient-funds refusal, a lost float
        // race the 409 float refusal with the refreshed float. The primitive
        // already compensated any applied prefix.
        try {
          await applyBondBuySpend(db, {
            bondId: bond._id,
            buyerKind: "imperial",
            buyerId: imperial._id,
            units,
            debitAmount: costLocal,
            costLocal,
            bondCurrency,
            forexEnabled,
            now,
            fingerprint: `bond-buy:${bond._id.toHexString()}:imperial:${imperial._id.toHexString()}:${units}:${costLocal}`,
            ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
          });
        } catch (error) {
          if (error instanceof MoneyFlowTerminalError) {
            return NextResponse.json(
              { error: "Purchase already settled; start a new attempt with a new key." },
              { status: 409 }
            );
          }
          if (error instanceof MoneyFlowKeyConflictError) {
            return NextResponse.json(
              { error: "Idempotency key was reused for a different purchase." },
              { status: 409 }
            );
          }
          const message = error instanceof Error ? error.message : "";
          if (message.startsWith(BOND_BUY_FUNDS)) {
            return NextResponse.json(
              {
                error: `Insufficient funds. Need ${costLocal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${bondCurrency}.`,
              },
              { status: 400 }
            );
          }
          if (message.startsWith(BOND_BUY_RESERVE)) {
            const latestBond = await db
              .collection<Bond>("bonds")
              .findOne({ _id: bond._id }, { projection: { publicFloat: 1 } });
            return NextResponse.json(
              { error: `Only ${latestBond?.publicFloat ?? 0} units available` },
              { status: 409 }
            );
          }
          throw error;
        }

        // Audit only: the keyed flow above already moved the money exactly
        // once. `emitTx` never throws, so a ledger failure cannot fail a
        // purchase whose money already moved.
        void emitTx(db, {
          type: "bond_purchase",
          turn: currentTurn,
          createdAt: now,
          subjectType: "character",
          subjectId: imperial._id,
          subjectName: imperial.name,
          amount: -costLocal,
          currencyCode: bondCurrency,
          counterpartyType: "system",
          counterpartyName: bond.issuerName ?? "Bond market",
          meta: {
            bondId: bond._id.toString(),
            units,
            pricePerUnit: quote.ask,
            imperial: true,
          },
        });

        return NextResponse.json({
          success: true,
          unitsBought: units,
          cost: Math.round(costLocal * 100) / 100,
          costCurrency: bondCurrency,
          pricePerUnit: quote.askPerUnit,
          buyer: "character",
        });
      }

      // ── Regular character buy path ──────────────────────────────
      const characterQuery = userDoc?.activeCharacterId
        ? { _id: userDoc.activeCharacterId, userId: new ObjectId(user.userId) }
        : { userId: new ObjectId(user.userId) };
      const character = await db.collection<Character>("characters").findOne(characterQuery);
      if (!character) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }

      // Block CEO / pending-CEO / recent-former-CEO from buying their own corp's
      // bonds (CEO ⊥ bondholder invariant). The former-CEO window closes the
      // "vacate CEO → buy own bonds → re-take CEO" loophole.
      const issuingCorp = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: bond.corporationId },
          { projection: { ceoId: 1, pendingCeoCharacterId: 1, ceoHistory: 1 } }
        );
      if (
        issuingCorp?.ceoId?.toString() === character._id.toString() ||
        issuingCorp?.pendingCeoCharacterId?.toString() === character._id.toString()
      ) {
        return NextResponse.json(
          { error: "Cannot buy your own corporation's bonds" },
          { status: 400 }
        );
      }
      if (
        issuingCorp &&
        wasCeoWithinTurns(issuingCorp, character._id, currentTurn, EX_CEO_BOND_PURCHASE_BLOCK_TURNS)
      ) {
        return NextResponse.json(
          { error: "Previous CEOs cannot buy bonds in this corporation at this time." },
          { status: 400 }
        );
      }

      // Convert currency for purchase
      let playerSpreadCharged = 0;
      if (forexEnabled) {
        const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
        if (payCurrency && payCurrency !== bondCurrency) {
          const convertResult = await convertForExplicitPay(db, {
            character,
            payCurrency,
            requiredCurrency: bondCurrency,
            requiredAmount: costLocal,
            turn: gs?.currentTurn ?? 0,
            forexEnabled,
          });
          if (!convertResult.success) {
            return NextResponse.json({ error: convertResult.error }, { status: 400 });
          }
          playerSpreadCharged = convertResult.spreadCharged;
        } else {
          const convertResult = await autoConvertForPurchase(db, {
            character,
            requiredCurrency: bondCurrency,
            requiredAmount: costLocal,
            turn: gs?.currentTurn ?? 0,
            forexEnabled,
          });
          if (convertResult.needed && !convertResult.success) {
            return NextResponse.json({ error: convertResult.error }, { status: 400 });
          }
          playerSpreadCharged = convertResult.spreadCharged;
        }
      }

      // The keyed flow below debits with a balance guard, so concurrent buys
      // cannot both pass the check on stale data.
      const charCapErr = sovereignBondCapError(bond, "characterId", character._id, units);
      if (charCapErr) {
        return NextResponse.json({ error: charCapErr }, { status: 400 });
      }
      // Map a keyed-settlement failure back onto the historical surface: a
      // lost funds race is the 400 insufficient-funds refusal, a lost float
      // race the 409 float refusal with the refreshed float. The primitive
      // already compensated any applied prefix, so no refund-and-rethrow.
      try {
        await applyBondBuySpend(db, {
          bondId: bond._id,
          buyerKind: "character",
          buyerId: character._id,
          units,
          debitAmount: costLocal,
          costLocal,
          bondCurrency,
          forexEnabled,
          now,
          fingerprint: `bond-buy:${bond._id.toHexString()}:character:${character._id.toHexString()}:${units}:${costLocal}`,
          ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
        });
      } catch (error) {
        if (error instanceof MoneyFlowTerminalError) {
          return NextResponse.json(
            { error: "Purchase already settled; start a new attempt with a new key." },
            { status: 409 }
          );
        }
        if (error instanceof MoneyFlowKeyConflictError) {
          return NextResponse.json(
            { error: "Idempotency key was reused for a different purchase." },
            { status: 409 }
          );
        }
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith(BOND_BUY_FUNDS)) {
          return NextResponse.json(
            {
              error: `Insufficient funds. Need ${costLocal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${bondCurrency}.`,
            },
            { status: 400 }
          );
        }
        if (message.startsWith(BOND_BUY_RESERVE)) {
          const latestBond = await db
            .collection<Bond>("bonds")
            .findOne({ _id: bond._id }, { projection: { publicFloat: 1 } });
          return NextResponse.json(
            { error: `Only ${latestBond?.publicFloat ?? 0} units available` },
            { status: 409 }
          );
        }
        throw error;
      }

      // Audit only: the keyed flow above already moved the money exactly
      // once. `emitTx` never throws, so a ledger failure cannot fail a
      // purchase whose money already moved.
      void emitTx(db, {
        type: "bond_purchase",
        turn: currentTurn,
        createdAt: now,
        subjectType: "character",
        subjectId: character._id,
        subjectName: character.name,
        amount: -costLocal,
        currencyCode: bondCurrency,
        counterpartyType: "system",
        counterpartyName: bond.issuerName ?? "Bond market",
        meta: { bondId: bond._id.toString(), units, pricePerUnit: bond.marketPrice },
      });

      return NextResponse.json({
        success: true,
        unitsBought: units,
        cost: Math.round(costLocal * 100) / 100,
        costCurrency: bondCurrency,
        pricePerUnit: quote.askPerUnit,
        buyer: "character",
        // FX spread already included in the cost when paying in a foreign
        // currency, surfaced so the player sees it wasn't lost.
        spreadPaid: Math.round(playerSpreadCharged * 100) / 100,
      });
    }
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/bonds/[bondId]/buy" });
  }
}
