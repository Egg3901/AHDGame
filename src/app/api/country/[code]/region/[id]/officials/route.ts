import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import {
  COUNTRY_CONFIGS,
  getRegionalExecutiveOfficeKey,
  isParliamentarySystem,
  type CountryId,
} from "@/lib/constants/countries";
import { getRegionOfficialBuckets } from "@/lib/legislature/chamberOfficeType";
import type { ElectedOfficial, State, Character, User } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/region/[id]/officials — Return all elected officials for a region, excluding banned players
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    // State ids are stored upper-case ("BEO", "SN"). The server-rendered region
    // page already uppercases before querying; this route did not, so a
    // lower-case id in the URL matched nothing and the parliament list came
    // back empty (ticket-1107).
    const stateId = id.toUpperCase();

    const db = await getDb();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Get all elected officials for this state
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ state: stateId, countryId })
      .sort({ officeType: 1, senateClass: 1, seatsHeld: -1 })
      .toArray();

    // Get character IDs that have officials
    const characterIds = officials.filter((o) => o.characterId).map((o) => o.characterId!);

    // Get the characters to find their user IDs
    const characters = await db
      .collection<Character>("characters")
      .find({ _id: { $in: characterIds } })
      .toArray();

    // Get user IDs from characters
    const userIds = characters.map((c) => c.userId);

    // Get users to check ban status
    const users = await db
      .collection<User>("users")
      .find({ _id: { $in: userIds } })
      .toArray();

    // Create a set of banned character IDs
    const bannedUserIds = new Set(users.filter((u) => u.isBanned).map((u) => u._id.toString()));
    const bannedCharacterIds = new Set(
      characters.filter((c) => bannedUserIds.has(c.userId.toString())).map((c) => c._id.toString())
    );

    // Filter out officials with banned characters and clear their data
    const filteredOfficials = officials.map((official) => {
      if (official.characterId && bannedCharacterIds.has(official.characterId.toString())) {
        // Return the office slot as vacant for banned users
        return {
          ...official,
          characterId: null,
          characterName: undefined,
          party: undefined,
        };
      }
      return official;
    });

    // Bucket by stored officeType — chamber keys are not always the office key
    // (DD volkskammer vs volkskammerDeputy, CN npc vs npcDelegate).
    const { senatorTypes, houseRepTypes, stateSenatorTypes } = getRegionOfficialBuckets(countryId);
    const regionalExecutiveOfficeKey = getRegionalExecutiveOfficeKey(countryId);

    const senators = filteredOfficials.filter((o) => senatorTypes.has(o.officeType));
    const houseReps = filteredOfficials.filter((o) => houseRepTypes.has(o.officeType));
    const stateSenators = filteredOfficials.filter((o) => stateSenatorTypes.has(o.officeType));
    const governor =
      filteredOfficials.find((o) => o.officeType === regionalExecutiveOfficeKey) ?? null;

    const countryConfig = COUNTRY_CONFIGS[countryId];
    const isParliamentary = isParliamentarySystem(countryConfig);
    // Parliamentary clients historically read `mps` for lower-chamber seats.
    const mps = isParliamentary ? houseReps : [];

    return NextResponse.json({
      state: stateId,
      stateName: state.name,
      countryId,
      officials: {
        senators,
        governor,
        houseRepresentatives: houseReps,
        stateSenators,
        mps,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
