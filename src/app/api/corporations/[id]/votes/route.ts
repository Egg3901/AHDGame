import { z } from "zod";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { openCorporationVote } from "@/lib/corporations/votes/voteService";
import {
  corporationDissolutionAgeBlock,
  dissolutionAgeBlockedMessage,
} from "@/lib/corporations/dissolutionAgeGuard";
import { notifyVoteEvent } from "@/lib/corporations/votes/voteNotifications";
import type { CorporationVote, CorporationVoteType } from "@/lib/db/types/corporationVote";
import type { LegalStructureId } from "@/lib/constants/legalStructures";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Character } from "@/lib/db/types";
import { commandEconomyRelocationBlock } from "@/lib/corporations/relocationCommandEconomyGate";
import {
  SUPERSHARE_MIN_MULTIPLIER,
  SUPERSHARE_MAX_MULTIPLIER,
} from "@/lib/corporations/superShares";

const OpenVoteSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("governance_change"), newLegalStructure: z.string() }),
  z.object({ type: z.literal("dissolution") }),
  z.object({
    type: z.literal("relocation"),
    destinationCountryId: z.string(),
    destinationStateCode: z.string(),
  }),
  z.object({
    type: z.literal("share_issuance"),
    newShareCount: z.number().int().positive(),
    issuancePrice: z.number().positive(),
    issuanceCurrencyCode: z.string(),
  }),
  z.object({
    type: z.literal("adopt_supershares"),
    superShareMultiplier: z
      .number()
      .int()
      .min(SUPERSHARE_MIN_MULTIPLIER, `Multiplier must be at least ${SUPERSHARE_MIN_MULTIPLIER}×`)
      .max(SUPERSHARE_MAX_MULTIPLIER, `Multiplier cannot exceed ${SUPERSHARE_MAX_MULTIPLIER}×`),
  }),
  z.object({
    type: z.literal("ticker_change"),
    newTicker: z
      .string()
      .min(1, "Ticker must be at least 1 character")
      .max(5, "Ticker cannot exceed 5 characters")
      .regex(/^[A-Z]+$/, "Ticker must be uppercase letters only"),
  }),
]);

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const query: Record<string, unknown> = { corporationId: corporation._id };
    if (statusFilter) query.status = statusFilter;
    const votes = await db
      .collection<CorporationVote>("corporationVotes")
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    return NextResponse.json(votes);
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const actionsGuard = await requireCorporationActionsEnabled(db);
    if (actionsGuard) return actionsGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: corporation.ceoId });
    if (!character) return errorResponse(404, "CEO character not found");

    const parsed = await parseJsonBody(request, OpenVoteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    if (
      body.type === "share_issuance" &&
      (corporation.pendingShareIssuance?.remainingShares ?? 0) > 0
    ) {
      return errorResponse(
        409,
        "This corporation still has an approved share issue awaiting market placement"
      );
    }

    if (body.type === "ticker_change") {
      const conflict = await db
        .collection("corporations")
        .findOne({ tickerSymbol: body.newTicker, _id: { $ne: corporation._id } });
      if (conflict) {
        return errorResponse(409, "That ticker is already in use by another corporation");
      }
      if (body.newTicker === corporation.tickerSymbol) {
        return errorResponse(400, "That is already your ticker symbol");
      }
    }

    if (body.type === "relocation") {
      const commandEconomyBlock = await commandEconomyRelocationBlock(
        db,
        corporation,
        corporation.countryId,
        body.destinationCountryId
      );
      if (commandEconomyBlock) {
        return errorResponse(400, commandEconomyBlock);
      }
    }

    // Players cannot dissolve a corp until it reaches the minimum age — block
    // proposing a dissolution vote on a too-new corp (admin actions are exempt).
    if (body.type === "dissolution") {
      const ageBlock = corporationDissolutionAgeBlock(corporation.foundedAtTurn, currentTurn);
      if (ageBlock.blocked) {
        return errorResponse(400, dissolutionAgeBlockedMessage(ageBlock.turnsRemaining));
      }
    }

    const payload =
      body.type === "governance_change"
        ? { newLegalStructure: body.newLegalStructure as LegalStructureId }
        : body.type === "relocation"
          ? {
              destinationCountryId: body.destinationCountryId as CountryId,
              destinationStateCode: body.destinationStateCode,
            }
          : body.type === "share_issuance"
            ? {
                newShareCount: body.newShareCount,
                issuancePrice: body.issuancePrice,
                issuanceCurrencyCode: body.issuanceCurrencyCode as CurrencyCode,
              }
            : body.type === "adopt_supershares"
              ? { superShareMultiplier: body.superShareMultiplier }
              : body.type === "ticker_change"
                ? { newTicker: body.newTicker }
                : {};

    const result = await openCorporationVote({
      db,
      corporation,
      character,
      currentTurn,
      type: body.type as CorporationVoteType,
      payload,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const inserted = await db
      .collection<CorporationVote>("corporationVotes")
      .findOne({ _id: new ObjectId(result.voteId) });
    if (inserted) {
      await notifyVoteEvent({
        db,
        vote: inserted,
        corpName: corporation.name,
        notificationType: "corp_vote_opened",
      });
    }

    return NextResponse.json({ voteId: result.voteId }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
