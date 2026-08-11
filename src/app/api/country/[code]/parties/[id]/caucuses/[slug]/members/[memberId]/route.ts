import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import type { CaucusMembership } from "@/lib/db/types";

// DELETE /api/country/[code]/parties/[id]/caucuses/[slug]/members/[memberId] — Remove a member
// Auth: requireAuthWithCharacter (member can leave themselves; chair can kick anyone but themselves)
// Errors: 400, 401, 403, 404
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string; memberId: string }> }
) {
  try {
    const { code, id, slug, memberId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (!ObjectId.isValid(memberId)) {
      return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);

    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus } = resolved;

    const memberOid = new ObjectId(memberId);
    const membership = await db
      .collection<CaucusMembership>("caucusMemberships")
      .findOne({ caucusId: caucus._id, memberId: memberOid, status: "active" });
    if (!membership) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    const callerId = auth.user.character._id;
    const isChair = caucus.chairId?.toString() === callerId.toString();
    const isSelf = membership.memberType === "character" && membership.memberId.equals(callerId);

    if (!isChair && !isSelf) {
      return NextResponse.json(
        { error: "Only the chair or the member themselves can remove this membership." },
        { status: 403 }
      );
    }

    // The chair can't kick themselves via this endpoint — chair role transfer
    // now happens through the caucus chair election flow or via PATCH /caucus +
    // an explicit "step down" flow. Disbanding clears the chair too.
    if (isChair && isSelf) {
      return NextResponse.json(
        {
          error:
            "Chairs can't leave the caucus directly — disband the caucus or hand the chair off via the next election.",
        },
        { status: 403 }
      );
    }

    const now = new Date();
    await db.collection<CaucusMembership>("caucusMemberships").updateOne(
      { _id: membership._id },
      {
        $set: {
          status: isSelf ? "left" : "removed",
          leftAt: now,
          updatedAt: now,
        },
      }
    );

    // Clear factionId so the member can join a different caucus.
    const collectionName = membership.memberType === "character" ? "characters" : "npps";
    await db
      .collection(collectionName)
      .updateOne(
        { _id: memberOid, factionId: caucus._id },
        { $set: { factionId: null, updatedAt: now } }
      );

    if (membership.memberType === "character") {
      await cleanupCaucusParticipationForCharacters(db, [memberOid], {
        caucusId: caucus._id,
        removeMembership: false,
        now,
      });
    }

    return NextResponse.json({ success: true, removed: !isSelf, left: isSelf });
  } catch (error) {
    return handleRouteError(error);
  }
}
