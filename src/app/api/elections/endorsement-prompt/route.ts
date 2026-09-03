import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getPartyMap } from "@/lib/db/partyMap";
import { isPrimaryPhaseOpen } from "@/lib/elections/playerEndorsements";
import { getGameTime } from "@/lib/time/gameTime";
import type { CountryId } from "@/lib/constants/countries";
import type { Election, ElectionCandidate, PlayerEndorsement } from "@/lib/db/types";

export interface EndorsementPromptCandidate {
  /** electionCandidates row id: what POST /endorse expects as `candidateId`. */
  id: string;
  name: string;
  partyAbbr: string;
  partyColor: string;
  isNPP: boolean;
  /** Candidate mood/momentum, 0..100. Absent on pre-Phase-4 rows. */
  support: number | null;
}

export interface EndorsementPromptResponse {
  prompt: {
    electionId: string;
    year: number | null;
    countryId: string;
    /** True while the primary is open, i.e. the list is restricted to your party. */
    inPrimary: boolean;
    candidates: EndorsementPromptCandidate[];
  } | null;
}

/** Max candidates returned to the nudge card. */
const PROMPT_CANDIDATE_LIMIT = 6;

const EMPTY: EndorsementPromptResponse = { prompt: null };

function noStore(body: EndorsementPromptResponse) {
  // Per-viewer by construction (own country, own party, own endorsement state).
  // Must never reach a shared cache.
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * GET /api/elections/endorsement-prompt: the "you haven't endorsed anyone for
 * president yet" nudge for the Actions page, or `{ prompt: null }` when there is
 * nothing to nudge about.
 *
 * Scoped to the caller's OWN country rather than hard-coded to the US, because
 * that is the rule `POST /api/elections/[id]/endorse` actually enforces
 * (`assertSameCountry`). A US player with a live US presidential race is the
 * case this exists for; gating on the literal string "US" would just mean the
 * card silently fails to appear the first time another presidential republic
 * ships one.
 *
 * Every reason the endorse endpoint would reject the player is filtered out
 * here, so the card never offers a button that 400s: ended races, races the
 * player already endorsed in, the player's own candidacy, cross-party
 * candidates while the primary is open, and suspended candidacies.
 *
 * Auth: requireHumanSessionWithCharacter
 * Errors: 401, 403
 */
export async function GET(request: Request) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;
    const character = auth.user.character;

    const db = await getDb();
    const countryId = character.countryId;

    // "upcoming" races are endorsable too (the endorse route only rejects
    // completed/resolved), and they are exactly when an endorsement is worth the
    // most, so include them and let the candidate list decide whether there is
    // anything to show.
    const election = await db.collection<Election>("elections").findOne(
      {
        electionType: "president",
        countryId,
        status: { $in: ["active", "upcoming"] },
      },
      { sort: { cycle: -1 } }
    );
    if (!election) return noStore(EMPTY);

    const existing = await db.collection<PlayerEndorsement>("playerEndorsements").findOne({
      characterId: character._id,
      electionId: election._id,
      isActive: true,
    });
    if (existing) return noStore(EMPTY);

    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: election._id, status: "active" })
      .toArray();
    if (candidates.length === 0) return noStore(EMPTY);

    // A suspended candidate cannot issue endorsements at all (endorse route
    // returns 400), so there is nothing to prompt them with.
    const ownCandidacy = candidates.find((c) => c.characterId?.equals(character._id));
    if (ownCandidacy?.campaignSuspended) return noStore(EMPTY);

    const { effectiveNow, currentTurn } = await getGameTime();
    const inPrimary = isPrimaryPhaseOpen(election, { currentTurn, now: effectiveNow });

    const endorsable = candidates.filter((c) => {
      if (c.characterId?.equals(character._id)) return false;
      if (inPrimary && c.party && c.party !== character.party) return false;
      return true;
    });
    if (endorsable.length === 0) return noStore(EMPTY);

    const partyMap = await getPartyMap(db, countryId as CountryId);

    // Strongest candidate first: Support is the canonical momentum store and is
    // the only ordering the player can act on without opening the race page.
    endorsable.sort((a, b) => {
      const diff = (b.support ?? 0) - (a.support ?? 0);
      return diff !== 0 ? diff : a.characterName.localeCompare(b.characterName);
    });
    // A crowded primary can field dozens of candidates, and the card is a nudge
    // on the Actions page, not the race page. Show the leading handful and let
    // the card's "View the full race" link carry the rest.
    const shown = endorsable.slice(0, PROMPT_CANDIDATE_LIMIT);

    return noStore({
      prompt: {
        electionId: election._id.toString(),
        // Baked at spawn time. Deliberately NOT recomputed via
        // electionToLarpYear: that needs the preset's cycle-anchor context out
        // of gameState, and defaulting it would mislabel every 1953-seeded
        // world. Legacy rows without the field just render without a year.
        year: election.electionYear ?? null,
        countryId,
        inPrimary,
        candidates: shown.map((c) => {
          const party = partyMap.get(String(c.party));
          return {
            id: c._id.toString(),
            name: c.characterName,
            partyAbbr: party?.abbreviation ?? (c.party || "IND"),
            partyColor: party?.color ?? "#9CA3AF",
            isNPP: c.isNPP === true,
            support: c.support ?? null,
          };
        }),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
