import { z } from "zod";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import {
  fileListingPetition,
  findActiveWaiver,
  findPendingPetition,
} from "@/lib/indexFunds/petitions/service";
import { requiredContributionAnchor } from "@/lib/indexFunds/petitions/rules";

/**
 * A7 part 2: the issuer's side of the index committee.
 *
 * GET  what this corporation's standing is: who the committee is, whether a
 *      petition is pending, whether a waiver is in force, and what an
 *      unattended petition would cost to carry.
 * POST file a petition and pay the lobbying contribution.
 */

const FileSchema = z.object({
  contributionAnchor: z.number().positive(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const authority = await resolveMergerAuthority(
      db,
      corporation.countryId as string,
      gameState?.currentYear ?? null
    );

    const [pending, waiver] = await Promise.all([
      findPendingPetition(db, corporation._id),
      findActiveWaiver(db, corporation._id, currentTurn),
    ]);

    const marketCapAnchor = (corporation.sharePrice ?? 0) * (corporation.totalShares ?? 0);

    return NextResponse.json({
      committee: authority
        ? {
            seatId: authority.seatId,
            seatName: authority.seatName,
            holderName: authority.holderName ?? null,
            holderIsNpp: authority.holderIsNpp ?? false,
            vacant: !authority.holderName,
          }
        : null,
      isCeo: corporation.ceoId?.equals(auth.user.character._id) ?? false,
      // What an unanswered petition needs to clear the automatic rule. Stated
      // outright: a hidden bar is a bar nobody can aim at.
      suggestedContributionAnchor: requiredContributionAnchor(marketCapAnchor),
      pending: pending
        ? {
            id: pending._id.toString(),
            filedAtTurn: pending.filedAtTurn,
            deadlineAtTurn: pending.deadlineAtTurn,
            contributionAnchor: pending.contributionAnchor,
            seatName: pending.seatName,
          }
        : null,
      waiver: waiver
        ? { id: waiver._id.toString(), waiverUntilTurn: waiver.waiverUntilTurn ?? null }
        : null,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // The corporation is the petitioner and the corporation's money is what is
    // spent, so the CEO is the only one who can commit it.
    const isCeo =
      (corporation.ceoType ?? "character") === "character" &&
      corporation.ceoId?.equals(auth.user.character._id);
    if (!isCeo) {
      return NextResponse.json(
        { error: "Only the CEO can petition the index committee" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, FileSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const gameState = await getGameState();
    const result = await fileListingPetition({
      db,
      corporation,
      filedByCharacterId: auth.user.character._id,
      contributionAnchor: parsed.data.contributionAnchor,
      currentTurn: gameState?.currentTurn ?? 0,
      currentYear: gameState?.currentYear ?? null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, petitionId: result.petition._id.toString() });
  } catch (e) {
    return handleRouteError(e);
  }
}
