import { z } from "zod";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import { decideListingPetition, INDEX_LISTING_PETITIONS } from "@/lib/indexFunds/petitions/service";
import type { IndexListingPetition } from "@/lib/db/types/indexListingPetition";

/**
 * The committee rules on a petition.
 *
 * Authority is re-resolved here rather than trusted from the petition record:
 * the seat may have changed hands since it was filed, and it is whoever holds
 * the seat NOW who decides. The contribution was paid to whoever held it then,
 * which is a risk the petitioner takes.
 */

const DecideSchema = z.object({
  grant: z.boolean(),
});

interface RouteParams {
  params: Promise<{ petitionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { petitionId } = await params;
    if (!ObjectId.isValid(petitionId)) {
      return NextResponse.json({ error: "Invalid petition ID" }, { status: 400 });
    }

    const db = await getDb();
    const petition = await db
      .collection<IndexListingPetition>(INDEX_LISTING_PETITIONS)
      .findOne({ _id: new ObjectId(petitionId) });
    if (!petition) return NextResponse.json({ error: "Petition not found" }, { status: 404 });

    const gameState = await getGameState();
    const authority = await resolveMergerAuthority(
      db,
      petition.countryId,
      gameState?.currentYear ?? null
    );
    if (!authority?.holderCharacterId?.equals(auth.user.character._id)) {
      return NextResponse.json(
        { error: "Only the seated officeholder can decide this petition" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, DecideSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const result = await decideListingPetition({
      db,
      petition,
      decidedByCharacterId: auth.user.character._id,
      grant: parsed.data.grant,
      currentTurn: gameState?.currentTurn ?? 0,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
