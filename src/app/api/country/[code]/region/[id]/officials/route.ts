import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";
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
    const stateId = id;

    const db = await getDb();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Get all elected officials for this state
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ state: stateId })
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

    // Separate by office type — parliamentary countries use their lower chamber key
    const countryConfig = COUNTRY_CONFIGS[countryId];
    const isParliamentary = isParliamentarySystem(countryConfig);
    const lowerChamberKey = countryConfig.legislature.lowerChamber.key;

    const senators = isParliamentary
      ? []
      : filteredOfficials.filter((o) => o.officeType === "senate");
    const governor = isParliamentary
      ? null
      : (filteredOfficials.find((o) => o.officeType === "governor") ?? null);
    const houseReps = isParliamentary
      ? []
      : filteredOfficials.filter((o) => o.officeType === "house");
    const mps = isParliamentary
      ? filteredOfficials.filter((o) => o.officeType === lowerChamberKey)
      : [];

    return NextResponse.json({
      state: stateId,
      stateName: state.name,
      countryId,
      officials: {
        senators,
        governor,
        houseRepresentatives: houseReps,
        mps,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
