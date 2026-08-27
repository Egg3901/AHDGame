// DELETE /api/country/[code]/executive/cabinet/[positionId]/generals/[characterId]
// The Secretary of Defense dismisses a general. The profile is retained (level, xp,
// traits) so a later re-appointment restores their record; only the commission is
// cleared. The dismissal cascades: they leave every command roster, any command they
// led loses its lead, their conflict postings are dropped, and units assigned to them
// fall to General Staff / reserve.
// Auth: defense holder or admin. Gated by conflictsEnabled + defense seat.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import {
  getCharacterGeneralsCollection,
  getCharacterCommission,
} from "@/lib/db/collections/characterGenerals";
import { severFromChainOfCommand } from "@/lib/military/severFromChainOfCommand";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; characterId: string }>;
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, characterId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 });
    }

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the defence minister may dismiss generals." },
        { status: 403 }
      );
    }

    const commission = await getCharacterCommission(db, characterId);
    if (!commission.commissioned) {
      return NextResponse.json({ error: "Not a commissioned general" }, { status: 404 });
    }

    // Cascade first, commission last. These writes are not transactional, and the
    // route 404s on an already-dismissed general — so clearing the commission first
    // would make a partial failure unretryable, stranding them on rosters and
    // postings forever. Cascading first leaves a still-commissioned general on a
    // failure, which simply re-running the dismissal fixes (the cascade is idempotent).
    //
    // A dismissed general cannot be left holding a command, a lead, or a posting.
    // Dismissing a theater commander vacates that front — authority falls back to the
    // defense holder until a successor is designated.
    // Shared with relocation, which severs the same ties when a commissioned
    // general emigrates. One definition, so the two events cannot drift.
    await severFromChainOfCommand(db, countryId, characterId);

    // Clear the commission but retain the profile — dismissal costs the post, not the
    // career, so re-appointing a veteran restores their record.
    await getCharacterGeneralsCollection(db).updateOne(
      { characterId },
      { $set: { commissioned: false, dismissedTurn: gs.currentTurn ?? 0 } }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
