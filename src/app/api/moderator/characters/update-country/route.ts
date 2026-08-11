import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createModAuditLog } from "@/lib/modAuditLog";
import type { Character, State } from "@/lib/db/types";
import { performRelocation } from "@/lib/character/performRelocation";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";

const updateCountrySchema = z.object({
  username: z.string().min(1, "Username is required"),
  // Runtime-validated below via isCountryEnabledForPlayers so admin-enabled
  // countries are accepted without a code redeploy.
  countryId: z.string(),
  homeState: z.string().optional(),
});

// PATCH /api/moderator/characters/update-country — Change countryId/homeState via the full relocation pipeline.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function PATCH(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, updateCountrySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { username, countryId: rawCountryId, homeState } = parsed.data;
    const countryId = rawCountryId.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: `Unknown country: ${rawCountryId}` }, { status: 400 });
    }

    const db = await getDb();
    if (!(await isCountryEnabledForPlayers(db, countryId))) {
      return NextResponse.json(
        { error: `Country ${countryId} is not enabled for players` },
        { status: 400 }
      );
    }

    const user = await db.collection("users").findOne({ username });
    if (!user) {
      return NextResponse.json({ error: `User '${username}' not found` }, { status: 404 });
    }
    if (user.role === "admin") {
      return NextResponse.json(
        { error: "Cannot perform actions on admin accounts" },
        { status: 403 }
      );
    }

    const character = await db.collection<Character>("characters").findOne({ userId: user._id });
    if (!character) {
      return NextResponse.json(
        { error: `No character found for user '${username}'` },
        { status: 404 }
      );
    }

    const targetStateId = homeState ?? character.homeState;
    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: targetStateId, countryId });
    if (!targetState) {
      return NextResponse.json(
        { error: `No state "${targetStateId}" in country "${countryId}"` },
        { status: 400 }
      );
    }

    if (character.homeState === targetStateId && (character.countryId ?? "US") === countryId) {
      return NextResponse.json({
        success: true,
        message: "No changes made (character already in target location)",
        character: {
          name: character.name,
          countryId: character.countryId ?? "US",
          homeState: character.homeState,
        },
      });
    }

    const outcome = await performRelocation(db, character, targetState);

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "update_character_country",
      targetUserId: user._id.toString(),
      targetUsername: user.username,
      details: `Relocated ${character.name} to ${countryId} (${targetStateId}) via full pipeline`,
    });

    return NextResponse.json({
      success: true,
      message: `Relocated ${character.name} to ${countryId} (${targetStateId}).`,
      character: {
        name: character.name,
        oldCountryId: character.countryId ?? "US",
        oldHomeState: character.homeState,
        newCountryId: countryId,
        newHomeState: targetStateId,
      },
      outcome,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
