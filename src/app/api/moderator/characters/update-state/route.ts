import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { createModAuditLog } from "@/lib/modAuditLog";
import { z } from "zod";
import { MAX_REGION_ID_LENGTH } from "@/lib/constants/states";
import type { Character, State } from "@/lib/db/types";
import { performRelocation } from "@/lib/character/performRelocation";

const updateStateSchema = z.object({
  username: z.string().min(1, "username is required"),
  /**
   * Shape only — see the admin twin of this route. Refining against the
   * US-only `STATE_IDS` meant no non-US player could be relocated at all. The
   * country-scoped `states` lookup below is the authoritative check, and it
   * enforces the same-country rule that the US-only list was standing in for.
   */
  homeState: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(
      z.string().min(1, "homeState is required").max(MAX_REGION_ID_LENGTH, "Invalid home state")
    ),
});

// PATCH /api/moderator/characters/update-state — Change homeState via the full relocation pipeline, within the character's own country.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function PATCH(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, updateStateSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { username, homeState } = parsed.data;

    const db = await getDb();

    const user = await db.collection("users").findOne({ username });
    if (!user) {
      return errorResponse(404, `User '${username}' not found`);
    }
    if (user.role === "admin") {
      return errorResponse(403, "Cannot perform actions on admin accounts");
    }

    const character = await db.collection<Character>("characters").findOne({ userId: user._id });
    if (!character) {
      return errorResponse(404, `No character found for user '${username}'`);
    }

    const oldState = character.homeState;
    if (oldState === homeState) {
      return NextResponse.json({
        success: true,
        message: `${character.name} is already in ${homeState} — no change made`,
      });
    }

    // Moderators move characters WITHIN their own country: scoping the lookup
    // to `character.countryId` both resolves the region and rejects
    // cross-country moves. This is the authoritative check on `homeState`.
    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: homeState, countryId: character.countryId });
    if (!targetState) {
      // Name the country searched — "not found" is far more often the wrong
      // country picked than a bad id. See the admin twin of this route.
      return errorResponse(
        400,
        `No region "${homeState}" in ${character.countryId} — ${character.name} is a ${character.countryId} character, and this move must stay inside their own country.`
      );
    }

    const outcome = await performRelocation(db, character, targetState);

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "update_character_state",
      targetUserId: user._id.toString(),
      targetUsername: user.username,
      details: `Relocated ${character.name} from ${oldState} to ${homeState} via full pipeline`,
    });

    return NextResponse.json({
      success: true,
      message: `${character.name}'s home state changed from ${oldState} to ${homeState}`,
      character: { name: character.name, oldState, newState: homeState },
      outcome,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
