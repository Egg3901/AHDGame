/**
 * PATCH /api/admin/characters/update-state
 * Admin: change a character's homeState via the full relocation pipeline.
 * Any country — the move is scoped to the character's own country, not to the US.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import { MAX_REGION_ID_LENGTH } from "@/lib/constants/states";
import type { Character, State } from "@/lib/db/types";
import { performRelocation } from "@/lib/character/performRelocation";

const updateStateSchema = z.object({
  username: z.string().min(1, "username is required"),
  /**
   * Shape only. This was refined against `STATE_IDS` — the 50 US `HOUSE_SEATS`
   * keys — so no non-US player could be relocated at all: every region id
   * outside America (`SEE`, `LON`, `CEN`, …) failed with "must be a valid US
   * state code". The real check is the country-scoped `states` lookup below,
   * which is what actually enforces the same-country rule.
   *
   * Region ids are uppercase in every country seed, so `.toUpperCase()` stays
   * a safe convenience rather than a US-shaped assumption.
   */
  homeState: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(
      z.string().min(1, "homeState is required").max(MAX_REGION_ID_LENGTH, "Invalid home state")
    ),
});

// PATCH /api/admin/characters/update-state — Change a character's homeState via the full relocation pipeline.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, updateStateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { username, homeState } = parsed.data;

    const db = await getDb();

    const user = await db.collection("users").findOne({ username });
    if (!user) {
      return NextResponse.json({ error: `User '${username}' not found` }, { status: 404 });
    }

    const character = await db.collection<Character>("characters").findOne({ userId: user._id });
    if (!character) {
      return NextResponse.json(
        { error: `No character found for user '${username}'` },
        { status: 404 }
      );
    }

    const oldState = character.homeState;
    if (oldState === homeState) {
      return NextResponse.json({
        success: true,
        message: `${character.name} is already in ${homeState} — no change made`,
      });
    }

    // Admins move characters WITHIN their own country: scoping the lookup to
    // `character.countryId` both resolves the region and rejects cross-country
    // moves in one step. This is the authoritative check on `homeState`.
    const targetState = await db
      .collection<State>("states")
      .findOne({ _id: homeState, countryId: character.countryId });
    if (!targetState) {
      // Name the country that was searched: the caller picks a region from a
      // country list, so "not found" is far more often the wrong country than
      // a bad id, and the old message could not tell those apart.
      return NextResponse.json(
        {
          error: `No region "${homeState}" in ${character.countryId} — ${character.name} is a ${character.countryId} character, and this move must stay inside their own country.`,
        },
        { status: 400 }
      );
    }

    const outcome = await performRelocation(db, character, targetState);

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
