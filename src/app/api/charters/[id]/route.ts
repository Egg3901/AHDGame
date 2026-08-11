import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import type { PartyCharter } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/charters/[id] — Returns a single charter.
 * Auth: requireAuthWithCharacter
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid charter ID" }, { status: 400 });
    }

    const db = await getDb();
    const charter = await db
      .collection<PartyCharter>("partyCharters")
      .findOne({ _id: new ObjectId(id) });
    if (!charter) {
      return NextResponse.json({ error: "Charter not found" }, { status: 404 });
    }

    return NextResponse.json({
      charter: {
        id: charter._id.toString(),
        countryId: charter.countryId,
        partyId: charter.partyId,
        proposedName: charter.proposedName,
        proposedAbbr: charter.proposedAbbr,
        foundersCharacterIds: charter.foundersCharacterIds.map((c) => c.toString()),
        pendingFounderSlots: charter.pendingFounderSlots,
        platform: charter.platform,
        signatures: charter.signatures.map((s) => ({
          characterId: s.characterId.toString(),
          signedAt: s.signedAt?.toISOString(),
          rejectedAt: s.rejectedAt?.toISOString(),
          rejectionReason: s.rejectionReason,
        })),
        status: charter.status,
        createdAt: charter.createdAt.toISOString(),
        expiresAt: charter.expiresAt?.toISOString() ?? null,
        ratifiedAt: charter.ratifiedAt?.toISOString(),
        founderReplacementDeadline: charter.founderReplacementDeadline?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
