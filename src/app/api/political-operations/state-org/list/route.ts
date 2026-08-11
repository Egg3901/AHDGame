import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, forbidden } from "@/lib/api/errors";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";
import { getPartyHex } from "@/lib/utils/politics";
import type { CharacterStateOrg, PoliticalParty } from "@/lib/db/types";

/**
 * GET /api/political-operations/state-org/list
 *
 * Returns the authenticated US character's per-state org levels for every
 * political US state (level 0 included). Consumed by the State Organization tab.
 * Unadmitted territories (Alaska/Hawaii under 1953) are omitted until admission.
 *
 * Auth: requireAuthWithCharacter (US-only)
 * Errors: 401, 403
 */
export async function GET() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const character = auth.user.character;
    if (character.countryId !== "US") {
      return NextResponse.json(forbidden("US-only").toJson(), { status: 403 });
    }

    const db = await getDb();
    const [rows, party, { politicalIds }] = await Promise.all([
      db
        .collection<CharacterStateOrg>("characterStateOrg")
        .find({ characterId: character._id })
        .toArray(),
      // Look up the character's party doc so custom-party hex colors flow
      // through to the map. Falls back to the canonical getPartyHex default
      // (blue / red / grey) when the doc is missing or the party is the
      // sentinel "independent".
      character.party && character.party !== "independent"
        ? db
            .collection<PoliticalParty>("politicalParties")
            .findOne(
              { countryId: "US", sequentialId: Number(character.party) },
              { projection: { color: 1, name: 1, abbreviation: 1 } }
            )
        : Promise.resolve(null),
      loadUsPoliticalStateIds(db),
    ]);
    const byState = new Map(rows.map((r) => [r.stateId, r]));

    const states = [...politicalIds].sort();
    const result = states.map((stateId) => {
      const row = byState.get(stateId);
      return {
        stateId,
        level: row?.level ?? 0,
        totalInvested: row?.totalInvested ?? 0,
        updatedAt: row?.updatedAt ?? null,
      };
    });

    const partyHex = getPartyHex(
      party?.abbreviation ?? character.party ?? "independent",
      party?.color
    );

    return NextResponse.json({
      states: result,
      homeState: character.homeState ?? null,
      partyHex,
      partyName: party?.name ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
