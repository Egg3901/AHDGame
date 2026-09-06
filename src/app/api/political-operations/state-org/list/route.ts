import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, forbidden } from "@/lib/api/errors";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";
import { getPartyHex } from "@/lib/utils/politics";
import { loadRacePresence } from "@/lib/politicalOperations/racePresence";
import { loadCampaignFxRate } from "@/lib/currency/campaignFxRate";
import { statePresenceNextCost } from "@/lib/campaigns/statePresenceCost";
import type { CharacterStateOrg, PoliticalParty } from "@/lib/db/types";

/**
 * GET /api/political-operations/state-org/list
 *
 * Returns the authenticated US character's per-state Campaign Presence levels for every
 * political US state or territory (level 0 included). Consumed by the State
 * Organization tab.
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
    const [rows, party, { residentPoliticalIds }, racePresence, fxRate] = await Promise.all([
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
      // Every candidate in the live presidential race, so the map can show the
      // contested ground and not just the viewer's own investment.
      loadRacePresence(db, character._id),
      // Priced server-side and handed back converted, so no screen has to know
      // that `stateOrgLevelCost` is anchor-denominated.
      loadCampaignFxRate(db, character),
    ]);
    const byState = new Map(rows.map((r) => [r.stateId, r]));

    const states = [...residentPoliticalIds].sort();
    const result = states.map((stateId) => {
      const row = byState.get(stateId);
      const level = row?.level ?? 0;
      return {
        stateId,
        level,
        totalInvested: row?.totalInvested ?? 0,
        updatedAt: row?.updatedAt ?? null,
        /** Cost of the NEXT level here, in the campaign's own currency. */
        nextCost: statePresenceNextCost(level, fxRate),
      };
    });

    const partyHex = getPartyHex(
      party?.abbreviation ?? character.party ?? "independent",
      party?.color
    );

    return NextResponse.json({
      states: result,
      /**
       * Anchor to the viewer's own currency. Rows already carry a converted
       * `nextCost`; this is for pricing a level the response did not enumerate,
       * such as another candidate's, through the same helper.
       */
      fxRate,
      racePresence,
      homeState: character.homeState ?? null,
      partyHex,
      partyName: party?.name ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
