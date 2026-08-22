import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { issueSharesSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { subsidiaryIssuanceBlockReason } from "@/lib/corporations/subsidiaries/issuanceGuard";
import { hasOpenPrivatizationVote } from "@/lib/corporations/commands/privatization/openVoteGuard";
import { MAX_PUBLIC_ISSUANCE_PERCENT } from "@/lib/constants/corporations";
import type { Corporation } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { corpLiquidCapitalToAnchor, getCorpFxRate } from "@/lib/currency/corporationCapital";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { issuanceDilutionFactorExpr } from "@/lib/corporations/shareConsolidation";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { CorporationVote } from "@/lib/db/types/corporationVote";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/shares/issue
 * CEO: Issue new shares to the public float (0–50% of current outstanding).
 * Proceeds at the current execution price go to corporate liquid capital.
 * Dilutes existing shareholders.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, issueSharesSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { percent } = parsed.data;
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

    if (corporation.isPrivate) {
      return NextResponse.json(
        {
          error:
            "Private corporations cannot issue shares to the public float. Use the Go Public action to IPO first.",
        },
        { status: 400 }
      );
    }

    if (await hasOpenPrivatizationVote(db, corporation._id)) {
      return NextResponse.json(
        { error: "Cannot issue new shares while a privatization vote is open" },
        { status: 400 }
      );
    }

    const openShareholderVote = await db
      .collection<CorporationVote>("corporationVotes")
      .findOne({ corporationId: corporation._id, status: "open" }, { projection: { _id: 1 } });
    if (openShareholderVote) {
      return NextResponse.json(
        { error: "Cannot issue shares while a shareholder vote is open" },
        { status: 400 }
      );
    }

    const currentShares = corporation.totalShares ?? 10_000_000;
    const newShares = Math.floor((percent / 100) * currentShares);

    const dilutionFraction = currentShares > 0 ? newShares / currentShares : 0;
    if (dilutionFraction > 0.1) {
      return NextResponse.json(
        {
          error:
            "Share issuances causing >10% dilution require a shareholder vote. Use the Propose Share Issuance flow.",
        },
        { status: 403 }
      );
    }

    if (percent > MAX_PUBLIC_ISSUANCE_PERCENT) {
      return NextResponse.json(
        { error: `Cannot issue more than ${MAX_PUBLIC_ISSUANCE_PERCENT}% of outstanding shares` },
        { status: 400 }
      );
    }

    if (newShares < 1) {
      return NextResponse.json(
        { error: "Issuance too small (rounds to 0 shares)" },
        { status: 400 }
      );
    }

    const executionPrice = resolveShareExecutionPrice(corporation);

    // Notional offering size at the current execution price. Issuance does NOT
    // credit this to liquidCapital — the corp realizes cash as the float is
    // actually bought (treasury-backed market maker). `proceeds` is the same
    // value normalized to ₳, kept for the audit row + API response.
    const proceedsInCorpCapital = newShares * executionPrice;
    const corpFxRate = await getCorpFxRate(db, corporation);
    const proceeds = corpLiquidCapitalToAnchor(proceedsInCorpCapital, corporation, corpFxRate);
    const now = new Date();
    const ISSUANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

    // Atomic cooldown check + update: prevents race condition where concurrent
    // requests could both pass the cooldown check before either completes
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

    const result = await db.collection<Corporation>("corporations").findOneAndUpdate(
      cooldownQuery as never,
      // Create float inventory only — no cash credited at issuance (Bug #0624).
      // liquidCapital + shareIssuanceProceeds are credited when the float sells.
      //
      // Prices scale DOWN by the dilution factor oldTotal / (oldTotal + new) in
      // the same atomic write: no cash enters at issuance, so market cap must be
      // preserved exactly like a forward split. See issuanceDilutionFactorExpr
      // and the matching fix on the vote-approved issuance path (voteEffects).
      [
        {
          $set: {
            totalShares: { $add: [{ $ifNull: ["$totalShares", 0] }, newShares] },
            publicFloat: { $add: [{ $ifNull: ["$publicFloat", 0] }, newShares] },
            sharePrice: {
              $round: [
                {
                  $multiply: [
                    { $ifNull: ["$sharePrice", 0] },
                    issuanceDilutionFactorExpr(newShares),
                  ],
                },
                4,
              ],
            },
            fundamentalSharePrice: {
              $round: [
                {
                  $multiply: [
                    { $ifNull: ["$fundamentalSharePrice", { $ifNull: ["$sharePrice", 0] }] },
                    issuanceDilutionFactorExpr(newShares),
                  ],
                },
                4,
              ],
            },
            lastShareIssuance: now,
            updatedAt: now,
          },
        },
      ],
      { returnDocument: "after" }
    );

    if (!result) {
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

    const newTotalShares = currentShares + newShares;
    const dilutedPrice = (executionPrice * currentShares) / newTotalShares;

    // sharePrice is stored in the target corp's liquidCurrencyCode; convert to ₳
    // for the audit row so history math is consistent across corps in different
    // currencies. `proceeds` above already carries the ₳-anchored total.
    void recordShareTrade(db, {
      corporationId: corporation._id,
      kind: "issuance",
      turn: await getCurrentTurn(db),
      shares: newShares,
      pricePerShareAnchor: proceeds / newShares,
      from: null,
      to: null,
      corpCurrencyCode: corporation.liquidCurrencyCode,
      note: `CEO issued ${newShares.toLocaleString()} shares to public float (${percent}% of outstanding)`,
    });

    // No ipo_proceeds ledger row: issuance moves no cash (Bug #0624). The cash
    // leg — and its financial-ledger entry — is emitted when the float is bought.
    // The `recordShareTrade` issuance row above still captures the dilution event.

    return NextResponse.json({
      success: true,
      sharesIssued: newShares,
      proceeds: Math.round(proceeds * 100) / 100,
      pricePerShare: executionPrice,
      newTotalShares,
      dilutedPrice: Math.round(dilutedPrice * 10000) / 10000,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
