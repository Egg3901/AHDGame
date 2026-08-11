import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getGameTime } from "@/lib/time/gameTime";
import { hasTurnBackedWindowClosed } from "@/lib/time/turnBackedWindow";
import type {
  StatePartyElection,
  StatePartyElectionPosition,
  State,
  Character,
} from "@/lib/db/types";

interface ValidationResult {
  success: true;
  stateId: string;
  partyId: string;
  character: Character;
  election: StatePartyElection;
}

interface ValidationError {
  success: false;
  response: NextResponse;
}

/**
 * Validates state party election access for a specific position.
 * Returns validated data or error response.
 */
export async function validateStatePartyElectionAccess(
  id: string,
  countryId: CountryId,
  partyId: string,
  position: StatePartyElectionPosition
): Promise<ValidationResult | ValidationError> {
  const stateId = id.toUpperCase();

  const authUser = await getAuthUserWithCharacter();
  if (!authUser || !authUser.character) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "You must have a character to participate" },
        { status: 401 }
      ),
    };
  }
  if (authUser.isBanned) {
    return {
      success: false,
      response: NextResponse.json({ error: "Account is banned" }, { status: 403 }),
    };
  }

  const db = await getDb();

  const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
  if (!state) {
    return {
      success: false,
      response: NextResponse.json({ error: "State not found" }, { status: 404 }),
    };
  }
  const party = await findPartyBySequentialId(db, partyId, countryId);
  if (!party) {
    return {
      success: false,
      response: NextResponse.json({ error: "Party not found" }, { status: 404 }),
    };
  }

  const canonicalPartyId = String(party.sequentialId);
  if (authUser.character.homeState !== stateId || authUser.character.party !== canonicalPartyId) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "You must be a member of this state party to participate" },
        { status: 403 }
      ),
    };
  }

  const election = await db.collection<StatePartyElection>("statePartyElections").findOne({
    stateId,
    partyId: canonicalPartyId,
    position,
    status: "voting",
  });

  if (!election) {
    return {
      success: false,
      response: NextResponse.json(
        { error: `No active ${position} election for this state party` },
        { status: 400 }
      ),
    };
  }

  const gameTime = await getGameTime();
  if (hasTurnBackedWindowClosed(election, gameTime.currentTurn, gameTime.effectiveNow)) {
    return {
      success: false,
      response: NextResponse.json(
        { error: `${position} election voting has already closed` },
        { status: 400 }
      ),
    };
  }

  return {
    success: true,
    stateId,
    partyId: canonicalPartyId,
    character: authUser.character,
    election,
  };
}
