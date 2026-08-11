// GET /api/pip/global — Returns a multi-country legislature snapshot, active crises, and turn context.
// Auth: public (admins see all countries; non-admins see only enabled countries)
// Errors: none
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { getPartyHex } from "@/lib/utils/politics";
import {
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
  getCountryConfig,
  type CountryId,
} from "@/lib/constants/countries";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { Crisis } from "@/lib/db/types/crisis";

// Derive primary legislature officeType from country config — avoids hardcoding per-country strings
function getPrimaryOfficeType(countryId: CountryId): string {
  return getCountryConfig(countryId).legislature.lowerChamber.key;
}

// Maps CountryId → state prefix filter
function matchesCountry(stateId: string, countryId: CountryId): boolean {
  if (countryId === COUNTRY_CONFIGS.UK.id) return stateId.startsWith("UK_");
  if (countryId === COUNTRY_CONFIGS.DE.id) return stateId.startsWith("DE_");
  // US: no prefix
  return !stateId.startsWith("UK_") && !stateId.startsWith("DE_");
}

export async function GET() {
  try {
    const db = await getDb();

    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    // Use enabled countries for non-admins, all countries for admins
    const countriesToShow = enabledCountries ?? COUNTRY_ORDER;

    const officeTypes = [...new Set(countriesToShow.map(getPrimaryOfficeType))];

    const [officials, parties, crises, activeElectionCounts, gameState] = await Promise.all([
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find({ officeType: { $in: officeTypes } })
        .project({ officeType: 1, party: 1, seatsHeld: 1, state: 1 })
        .toArray(),
      db
        .collection<PoliticalParty>("politicalParties")
        .find(enabledCountries ? { countryId: { $in: enabledCountries } } : {})
        .project({ _id: 1, name: 1, color: 1, countryId: 1 })
        .toArray() as Promise<Pick<PoliticalParty, "_id" | "name" | "color" | "countryId">[]>,
      db
        .collection<Crisis>("crises")
        .find({ status: "active" })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),
      // Active election counts per country
      Promise.all(
        countriesToShow.map((cId) =>
          db
            .collection("elections")
            .countDocuments({ countryId: cId, status: { $in: ["active", "upcoming"] } })
            .then((count) => [cId, count] as [CountryId, number])
        )
      ),
      getGameState(),
    ]);

    const activeElectionMap = new Map(activeElectionCounts);
    // Key by party _id (which is the party slug string)
    const partyMap = new Map(parties.map((p) => [p._id.toString(), p]));

    const countries = countriesToShow.map((countryId) => {
      const officeType = getPrimaryOfficeType(countryId);
      const countryOfficials = officials.filter(
        (o) => o.officeType === officeType && o.state && matchesCountry(o.state, countryId)
      );

      // Tally seats per party
      const seatsByParty = countryOfficials.reduce(
        (acc, o) => {
          const key = o.party ?? "vacant";
          acc[key] = (acc[key] ?? 0) + (o.seatsHeld ?? 1);
          return acc;
        },
        {} as Record<string, number>
      );

      const totalSeats = Object.values(seatsByParty).reduce((s, n) => s + n, 0);
      const [dominantPartyId, dominantSeats] = Object.entries(seatsByParty).sort(
        ([, a], [, b]) => b - a
      )[0] ?? ["vacant", 0];

      const partyDoc = partyMap.get(dominantPartyId);
      const config = getCountryConfig(countryId);

      return {
        id: countryId,
        dominantParty: dominantPartyId,
        dominantPartyName: partyDoc?.name ?? dominantPartyId,
        dominantPartyColor: getPartyHex(dominantPartyId, partyDoc?.color),
        dominantSeats,
        totalSeats,
        activeElections: activeElectionMap.get(countryId) ?? 0,
        legislatureName: config.legislature.lowerChamber.name,
      };
    });

    const crisesResponse = crises.map((c) => ({
      id: c._id.toString(),
      name: c.name,
      scope: c.scope,
      countryIds: c.countryIds,
      status: c.status,
    }));

    return NextResponse.json(
      {
        countries,
        crises: crisesResponse,
        turn: {
          currentTurn: gameState?.currentTurn ?? 0,
          currentYear: gameState?.currentYear ?? 0,
        },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
