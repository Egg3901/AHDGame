import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
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

// PATCH /api/admin/characters/update-country — Change a character's countryId/homeState via the full relocation pipeline.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, updateCountrySchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { username, countryId: rawCountryId, homeState } = parsed.data;
    const countryId = rawCountryId.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, `Unknown country: ${rawCountryId}`);
    }

    const db = await getDb();
    if (!(await isCountryEnabledForPlayers(db, countryId))) {
      return errorResponse(400, `Country ${countryId} is not enabled for players`);
    }

    const user = await db.collection("users").findOne({ username });
    if (!user) {
      return errorResponse(404, `User '${username}' not found`);
    }

    const character = await db.collection<Character>("characters").findOne({ userId: user._id });
    if (!character) {
      return errorResponse(404, `No character found for user '${username}'`);
    }

    const targetStateId = homeState ?? character.homeState;
    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: targetStateId, countryId });
    if (!targetState) {
      return errorResponse(400, `No state "${targetStateId}" in country "${countryId}"`);
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

    return NextResponse.json({
      success: true,
      message: `Relocated ${character.name} to ${targetState.name} (${countryId}).`,
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
