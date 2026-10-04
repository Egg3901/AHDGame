import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { issueSharesSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
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
import {
  prepareEquityPrimaryPlacement,
  planEquityPrimaryPlacement,
  refundPreparedEquityPlacement,
} from "@/lib/equities/primaryMarket";
import { emitTx } from "@/lib/financialTxLog/emit";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { resolvePrimaryUnderwritingOffer } from "@/lib/banking/underwritingOffer";
import { settlePrimaryUnderwritingFill } from "@/lib/banking/underwritingSettlement";
import { equityPoolCurrency } from "@/lib/equities/marketPool";

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
    if (subBlock) return errorResponse(403, subBlock);

    if (corporation.isPrivate) {
      return errorResponse(
        400,
        "Private corporations cannot issue shares to the public float. Use the Go Public action to IPO first."
      );
    }

    if (await hasOpenPrivatizationVote(db, corporation._id)) {
      return errorResponse(400, "Cannot issue new shares while a privatization vote is open");
    }

    const openShareholderVote = await db
      .collection<CorporationVote>("corporationVotes")
      .findOne({ corporationId: corporation._id, status: "open" }, { projection: { _id: 1 } });
    if (openShareholderVote) {
      return errorResponse(400, "Cannot issue shares while a shareholder vote is open");
    }
    if ((corporation.pendingShareIssuance?.remainingShares ?? 0) > 0) {
      return errorResponse(
        409,
        "This corporation still has an approved share issue awaiting market placement"
      );
    }

    const currentShares = corporation.totalShares ?? 10_000_000;
    const newShares = Math.floor((percent / 100) * currentShares);

    const dilutionFraction = currentShares > 0 ? newShares / currentShares : 0;
    if (dilutionFraction > 0.1) {
      return errorResponse(
        403,
        "Share issuances causing >10% dilution require a shareholder vote. Use the Propose Share Issuance flow."
      );
    }

    if (percent > MAX_PUBLIC_ISSUANCE_PERCENT) {
      return errorResponse(
        400,
        `Cannot issue more than ${MAX_PUBLIC_ISSUANCE_PERCENT}% of outstanding shares`
      );
    }

    if (newShares < 1) {
      return errorResponse(400, "Issuance too small (rounds to 0 shares)");
    }

    const executionPrice = resolveShareExecutionPrice(corporation);

    const now = new Date();
    const currentTurn = await getCurrentTurn(db);
    const corpFxRate = await getCorpFxRate(db, corporation);
    // The currency pool underwrites a bounded first tranche with real cash.
    // Anything it cannot place remains approved-but-unissued and is paced into
    // the float by the turn processor, exactly like an unsold bond remainder.
    const underwriting = corporation.primaryUnderwritingMandate
      ? await resolvePrimaryUnderwritingOffer(
          db,
          await loadBankingPolicy(db),
          corporation,
          equityPoolCurrency(corporation),
          "equity",
          currentTurn
        )
      : null;
    const plannedPlacement = underwriting
      ? await planEquityPrimaryPlacement(db, corporation, newShares, executionPrice)
      : null;
    const legacyPlacement = plannedPlacement?.poolActive
      ? null
      : await prepareEquityPrimaryPlacement(db, corporation, newShares, executionPrice, now);
    const placement = plannedPlacement?.poolActive
      ? { ...plannedPlacement, paidLocal: plannedPlacement.plannedGrossLocal }
      : legacyPlacement!;
    const underwritingFillId = underwriting && placement.poolActive ? new ObjectId() : undefined;
    const frozenUnderwritingOffer = underwritingFillId
      ? { ...underwriting!.offer, instrumentId: underwritingFillId }
      : undefined;
    const placedShares = placement.placedShares;
    const grossProceedsLocal = placement.poolActive
      ? placement.paidLocal
      : newShares * executionPrice;
    const underwritingFeeLocal = frozenUnderwritingOffer
      ? Math.round(grossProceedsLocal * frozenUnderwritingOffer.feeRate * 100) / 100
      : 0;
    const proceedsInCorpCapital = grossProceedsLocal - underwritingFeeLocal;
    const proceeds = corpLiquidCapitalToAnchor(proceedsInCorpCapital, corporation, corpFxRate);
    const ISSUANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

    // Atomic cooldown check + update: prevents race condition where concurrent
    // requests could both pass the cooldown check before either completes
    const cooldownQuery = {
      _id: corporation._id,
      "pendingShareIssuance.remainingShares": { $not: { $gt: 0 } },
      $or: [
        { lastShareIssuance: null },
        { lastShareIssuance: { $exists: false } },
        { lastShareIssuance: { $lte: new Date(Date.now() - ISSUANCE_COOLDOWN_MS) } },
      ],
    };

    const updatePipeline = [
      {
        $set: {
          totalShares: { $add: [{ $ifNull: ["$totalShares", 0] }, placedShares] },
          publicFloat: { $add: [{ $ifNull: ["$publicFloat", 0] }, placedShares] },
          ...(placement.poolActive
            ? {
                ...(!frozenUnderwritingOffer
                  ? {
                      liquidCapital: {
                        $add: [{ $ifNull: ["$liquidCapital", 0] }, placement.paidLocal],
                      },
                    }
                  : {}),
                shareIssuanceProceeds: {
                  $add: [{ $ifNull: ["$shareIssuanceProceeds", 0] }, proceedsInCorpCapital],
                },
              }
            : {}),
          sharePrice: {
            $round: [
              {
                $multiply: [
                  { $ifNull: ["$sharePrice", 0] },
                  issuanceDilutionFactorExpr(placedShares),
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
                  issuanceDilutionFactorExpr(placedShares),
                ],
              },
              4,
            ],
          },
          lastShareIssuance: now,
          ...(placement.unsoldShares > 0
            ? {
                pendingShareIssuance: {
                  remainingShares: placement.unsoldShares,
                  requestedShares: newShares,
                  source: "direct",
                  createdAtTurn: currentTurn,
                  initialPriceLocal: executionPrice,
                  ...(frozenUnderwritingOffer ? { underwriting: frozenUnderwritingOffer } : {}),
                },
              }
            : {}),
          updatedAt: now,
        },
      },
    ];
    let result: Corporation | null;
    try {
      if (frozenUnderwritingOffer && placedShares > 0 && underwriting) {
        const settlement = await settlePrimaryUnderwritingFill(db, {
          bank: underwriting.bank,
          issuer: corporation,
          issuerCurrencyCode: placement.currency,
          offer: frozenUnderwritingOffer,
          instrumentId: underwritingFillId!,
          grossPlacedLocal: placement.paidLocal,
          turn: currentTurn,
          now,
          poolCollection: "equityMarketPools",
          instrumentProjection: {
            collection: "corporations",
            filter: cooldownQuery,
            pipelineUpdate: updatePipeline,
            note: "Publish the funded share issuance and approved pending remainder",
          },
        });
        if (settlement.status !== "applied" && settlement.status !== "replayed") {
          return NextResponse.json(
            { error: "The share placement is settling; retry after its journal completes." },
            { status: settlement.status === "partial" ? 202 : 409 }
          );
        }
        result = corporation;
      } else {
        result = await db
          .collection<Corporation>("corporations")
          .findOneAndUpdate(cooldownQuery as never, updatePipeline, { returnDocument: "after" });
      }
    } catch (error) {
      if (!frozenUnderwritingOffer) await refundPreparedEquityPlacement(db, placement, now);
      throw error;
    }

    if (!result) {
      if (!frozenUnderwritingOffer) await refundPreparedEquityPlacement(db, placement, now);
      const elapsed = corporation.lastShareIssuance
        ? Date.now() - new Date(corporation.lastShareIssuance).getTime()
        : 0;
      const remaining = Math.ceil((ISSUANCE_COOLDOWN_MS - elapsed) / 1000 / 60 / 60);
      return errorResponse(
        429,
        `Share issuance is limited to once per 24 hours. Try again in ${remaining}h.`
      );
    }

    const newTotalShares = currentShares + placedShares;
    const dilutedPrice =
      newTotalShares > 0 ? (executionPrice * currentShares) / newTotalShares : executionPrice;

    // sharePrice is stored in the target corp's liquidCurrencyCode; convert to ₳
    // for the audit row so history math is consistent across corps in different
    // currencies. `proceeds` above already carries the ₳-anchored total.
    if (placedShares > 0) {
      void recordShareTrade(db, {
        corporationId: corporation._id,
        kind: "issuance",
        turn: currentTurn,
        shares: placedShares,
        pricePerShareAnchor: proceeds / placedShares,
        from: null,
        to: null,
        corpCurrencyCode: corporation.liquidCurrencyCode,
        note: `Equity market pool placed ${placedShares.toLocaleString()} of ${newShares.toLocaleString()} CEO-issued shares (${percent}% requested)`,
      });
    }

    if (placement.poolActive && placement.paidLocal > 0) {
      void emitTx(db, {
        type: "ipo_proceeds",
        turn: currentTurn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: corporation._id,
        subjectName: corporation.name,
        amount: proceedsInCorpCapital,
        currencyCode: placement.currency,
        meta: {
          sharesPlaced: placedShares,
          sharesRequested: newShares,
          sharesPending: placement.unsoldShares,
          counterparty: "equity_market_pool",
          ...(underwritingFeeLocal > 0
            ? {
                grossPlacedLocal: grossProceedsLocal,
                underwritingFeeLocal,
                issuerNetLocal: proceedsInCorpCapital,
              }
            : {}),
        },
      });
    }

    return NextResponse.json({
      success: true,
      sharesRequested: newShares,
      sharesIssued: placedShares,
      sharesPending: placement.unsoldShares,
      proceeds: Math.round(proceeds * 100) / 100,
      pricePerShare: executionPrice,
      newTotalShares,
      dilutedPrice: Math.round(dilutedPrice * 10000) / 10000,
      ...(underwritingFeeLocal > 0
        ? {
            grossPlacedLocal: grossProceedsLocal,
            underwritingFeeLocal,
            issuerNetLocal: proceedsInCorpCapital,
          }
        : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
