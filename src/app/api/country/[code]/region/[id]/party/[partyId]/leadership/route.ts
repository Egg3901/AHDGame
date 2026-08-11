import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { statePartyAppointmentSchema } from "@/lib/api/schemas/leadership";
import { createAdminLog } from "@/lib/adminLog";
import type { StatePartyOrg, State, Character, User } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getPartyTenure,
  STATE_LEADERSHIP_RELOCATION_DELAY_TURNS,
} from "@/lib/parties/leadershipTenure";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

type LeadershipPosition = "chair" | "viceChair" | "treasurer";

// POST /api/country/[code]/region/[id]/party/[partyId]/leadership — Appoint a character to a state party leadership position
// Auth: requireAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    // Verify authentication
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = auth.user;

    const db = await getDb();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, statePartyAppointmentSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { position, characterId } = parsed.data;

    const partyKey = getPartyIdString(party);

    // Get or create state party org record
    const statePartyOrgId = getStatePartyOrgDocumentId(stateId, party);
    const statePartyOrg = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
      _id: statePartyOrgId,
    });

    // Check authorization
    const isAdmin = authUser.isAdmin;
    const userCharacterId = authUser.character?._id.toString();
    const nationalChairId = party.chairId?.toString();

    const isNationalChair = nationalChairId && userCharacterId === nationalChairId;

    // Vice chair and treasurer are elected positions — only admins can directly appoint them
    if (position !== "chair" && !isAdmin) {
      return NextResponse.json(
        { error: "Vice chair and treasurer positions are filled by election" },
        { status: 403 }
      );
    }

    // National chair can appoint state chair, but ONLY when vacant
    if (!isAdmin) {
      if (!isNationalChair) {
        return NextResponse.json(
          {
            error: "Unauthorized - You must be the national party chair or an admin",
          },
          { status: 403 }
        );
      }
      // Verify the existing chair is still valid — a stale chairId pointing
      // to a deleted/banned/party-left character does not block appointment.
      let chairPositionIsVacant = true;
      if (statePartyOrg?.chairId) {
        const existingChair = await db
          .collection<Character>("characters")
          .findOne({ _id: statePartyOrg.chairId });
        if (existingChair && existingChair.party === partyKey) {
          chairPositionIsVacant = false;
        }
      }
      if (!chairPositionIsVacant) {
        return NextResponse.json(
          {
            error:
              "State chair position is not vacant - national chair cannot remove or replace an elected state chair",
          },
          { status: 403 }
        );
      }
      if (!characterId) {
        return NextResponse.json(
          { error: "National party chair cannot vacate the state chair position" },
          { status: 403 }
        );
      }
    }

    // If appointing a character
    let appointedCharacter: Character | null = null;
    if (characterId) {
      let characterObjectId: ObjectId;
      try {
        characterObjectId = new ObjectId(characterId);
      } catch {
        return NextResponse.json({ error: "Invalid characterId format" }, { status: 400 });
      }

      // Find the character
      appointedCharacter = await db.collection<Character>("characters").findOne({
        _id: characterObjectId,
      });

      if (!appointedCharacter) {
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }

      // Validate character is in this party
      if (appointedCharacter.party !== partyKey) {
        return NextResponse.json(
          { error: "Character must be a member of this party" },
          { status: 400 }
        );
      }

      // Validate character is in this state
      if (appointedCharacter.homeState !== stateId) {
        return NextResponse.json({ error: "Character must be from this state" }, { status: 400 });
      }

      // Check if character is banned
      const user = await db.collection<User>("users").findOne({ _id: appointedCharacter.userId });
      if (user?.isBanned) {
        return NextResponse.json({ error: "Cannot appoint a banned user" }, { status: 400 });
      }

      // Relocation-tenure gate: a character who relocated within the last
      // STATE_LEADERSHIP_RELOCATION_DELAY_TURNS turns can't be appointed into
      // state leadership. Applies on EVERY path through this route — including
      // when an admin is also the national chair — so the only exemption is the
      // dedicated Admin Panel route (/api/admin/state-party/.../appoint).
      const { currentTurn } = await getGameTime();
      const relocTenure = getPartyTenure(
        appointedCharacter.lastRelocatedTurn,
        currentTurn,
        STATE_LEADERSHIP_RELOCATION_DELAY_TURNS
      );
      if (!relocTenure.eligible) {
        return NextResponse.json(
          {
            error: `${appointedCharacter.name} relocated recently and can't be appointed to state leadership for ${relocTenure.turnsRemaining} more turn${relocTenure.turnsRemaining === 1 ? "" : "s"}.`,
            turnsRemaining: relocTenure.turnsRemaining,
          },
          { status: 403 }
        );
      }
    }

    // Build the update
    const now = new Date();
    const positionField = `${position}Id`;
    const updateValue = characterId ? new ObjectId(characterId) : null;
    const leadershipReset: Partial<Pick<StatePartyOrg, "chairId" | "viceChairId" | "treasurerId">> =
      {};
    if (statePartyOrg && updateValue) {
      const otherPositions: LeadershipPosition[] = ["chair", "viceChair", "treasurer"].filter(
        (p) => p !== position
      ) as LeadershipPosition[];
      for (const otherPos of otherPositions) {
        const otherField = `${otherPos}Id` as keyof Pick<
          StatePartyOrg,
          "chairId" | "viceChairId" | "treasurerId"
        >;
        const otherId = statePartyOrg[otherField];
        if (otherId?.equals(updateValue)) {
          leadershipReset[otherField] = null;
        }
      }
    }

    // Build $setOnInsert without the field being updated (to avoid conflict).
    // countryId is REQUIRED: a row created here without it is invisible to
    // every countryId-scoped query (e.g. build-org PS spend, which then fails
    // with "missing-row"), and to the state overview party list.
    const setOnInsertFields: Record<string, unknown> = {
      countryId,
      stateId,
      partyId: partyKey,
      organization: 0,
      createdAt: now,
    };

    // Add the other leadership fields (not the one being set). A field that is
    // already cleared via leadershipReset lives in $set, so it must NOT also
    // appear in $setOnInsert — MongoDB rejects the same path in both operators
    // with "Updating the path 'viceChairId' would create a conflict" (the doc
    // mutates both when the appointee currently holds another position).
    if (position !== "chair" && !("chairId" in leadershipReset)) setOnInsertFields.chairId = null;
    if (position !== "viceChair" && !("viceChairId" in leadershipReset))
      setOnInsertFields.viceChairId = null;
    if (position !== "treasurer" && !("treasurerId" in leadershipReset))
      setOnInsertFields.treasurerId = null;

    await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
      { _id: statePartyOrgId },
      {
        $set: {
          ...leadershipReset,
          [positionField]: updateValue,
          updatedAt: now,
        },
        $setOnInsert: setOnInsertFields,
      },
      { upsert: true }
    );

    // Log the action
    const positionLabel =
      position === "chair" ? "Chair" : position === "viceChair" ? "Vice Chair" : "Treasurer";

    if (appointedCharacter) {
      const appointedUser = await db
        .collection<User>("users")
        .findOne({ _id: appointedCharacter.userId });
      await createAdminLog({
        category: "election",
        action: "official_appointed",
        username: appointedUser?.username || "unknown",
        characterName: appointedCharacter.name,
        adminUsername: authUser.username,
        details: `Appointed as ${state.name} ${party.name} State ${positionLabel}`,
      });
      try {
        const { awardAchievement } = await import("@/lib/achievements");
        await awardAchievement(appointedCharacter.userId, "party_leader", appointedCharacter._id);
      } catch (e) {
        console.error("Achievement check failed:", e);
      }
    } else {
      // Vacating the position
      await createAdminLog({
        category: "system",
        action: "party_org_updated",
        username: authUser.username,
        details: `Vacated ${state.name} ${party.name} State ${positionLabel} position`,
      });
    }

    return NextResponse.json({
      success: true,
      message: characterId
        ? `${appointedCharacter!.name} appointed as ${state.name} ${party.name} State ${positionLabel}`
        : `${state.name} ${party.name} State ${positionLabel} position vacated`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
