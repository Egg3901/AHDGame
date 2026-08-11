import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { isPlayerRandomEventsEnabled, isWorldEventsEnabled } from "@/lib/events/featureFlag";
import {
  buildActiveEventForCharacter,
  buildActiveEventForCountry,
  buildLastResolvedForCharacter,
} from "@/lib/events/pree/activeEvent";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import type { CountryId } from "@/lib/constants/countries";

// GET /api/events/active - Pending random event (with options) for the current character,
// plus their most recent resolved outcome for the actions-page card. When the character
// currently holds their country's executive office and worldEventsEnabled is on, a pending
// country-scope event takes priority over their own character-scope event.
// Auth: requireAuthWithCharacter
// Errors: 401
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = Date.now();
    const character = auth.user.character;

    if (await isWorldEventsEnabled()) {
      const leaderCharId = await getHeadOfGovernmentCharacterId(
        db,
        character.countryId as CountryId
      );
      if (leaderCharId?.equals(character._id)) {
        const countryEvent = await buildActiveEventForCountry(
          db,
          character.countryId as CountryId,
          now
        );
        if (countryEvent) {
          return NextResponse.json({ event: countryEvent, lastResolved: null });
        }
      }
    }

    // Master switch off → no Event Card, even if an instance is still pending
    // (it sweeps to the default option at expiry).
    if (!(await isPlayerRandomEventsEnabled())) {
      return NextResponse.json({ event: null, lastResolved: null });
    }

    const characterId = character._id;
    const event = await buildActiveEventForCharacter(db, characterId, now);
    const lastResolved = event ? null : await buildLastResolvedForCharacter(db, characterId, now);
    return NextResponse.json({ event, lastResolved });
  } catch (error) {
    return handleRouteError(error);
  }
}
