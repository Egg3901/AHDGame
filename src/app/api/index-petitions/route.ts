import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import { INDEX_LISTING_PETITIONS } from "@/lib/indexFunds/petitions/service";
import type { IndexListingPetition } from "@/lib/db/types/indexListingPetition";
import type { Corporation } from "@/lib/db/types";

/**
 * The committee's own inbox: petitions waiting on the seat this character
 * holds. Returns an empty list for everyone else rather than a 403, because
 * "you are not the officeholder" is the normal case, not an error.
 */
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await getGameState();
    const character = auth.user.character;

    const authority = await resolveMergerAuthority(
      db,
      character.countryId as string,
      gameState?.currentYear ?? null
    );
    if (!authority?.holderCharacterId?.equals(character._id)) {
      return NextResponse.json({ seat: null, petitions: [] });
    }

    const petitions = await db
      .collection<IndexListingPetition>(INDEX_LISTING_PETITIONS)
      .find({ status: "pending", countryId: character.countryId })
      .sort({ deadlineAtTurn: 1 })
      .toArray();

    const corps = await db
      .collection<Corporation>("corporations")
      .find(
        { _id: { $in: petitions.map((p) => p.corporationId) } },
        { projection: { name: 1, tickerSymbol: 1 } }
      )
      .toArray();
    const nameById = new Map(corps.map((c) => [c._id.toString(), c.name]));

    return NextResponse.json({
      seat: { seatId: authority.seatId, seatName: authority.seatName },
      petitions: petitions.map((p) => ({
        id: p._id.toString(),
        corporationId: p.corporationId.toString(),
        corporationName: nameById.get(p.corporationId.toString()) ?? "Unknown",
        filedAtTurn: p.filedAtTurn,
        deadlineAtTurn: p.deadlineAtTurn,
        contributionAnchor: p.contributionAnchor,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
