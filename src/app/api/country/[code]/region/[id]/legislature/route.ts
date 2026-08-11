import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import {
  COUNTRY_CONFIGS,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { subNationalChamberSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import type { State, ElectedOfficial, PoliticalParty, Character, NPP } from "@/lib/db/types";

// GET /api/country/[code]/region/[id]/legislature — Return the state senate composition and current officials for a region
// Auth: public
// Errors: 400, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const db = await getDb();

    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: getSubNationalLegislatureKey(countryId), state: stateId })
      .toArray();

    // Filter parties by country to avoid cross-country sequential ID collisions
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId })
      .toArray();
    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

    const composition: Record<
      string,
      { seats: number; color: string; name: string; economicPosition: number; countryId: string }
    > = {};
    let filledSeats = 0;

    for (const official of officials) {
      const partyId = official.party ?? "independent";
      const seats = official.seatsHeld ?? 1;
      filledSeats += seats;

      if (!composition[partyId]) {
        const party = partyMap.get(partyId);
        composition[partyId] = {
          seats: 0,
          color: party?.color ?? "#6b7280",
          name: party?.name ?? partyId,
          economicPosition: party?.economicPosition ?? 0,
          countryId,
        };
      }
      composition[partyId].seats += seats;
    }

    let governor = null;
    if (countryId !== "UK") {
      governor = await db.collection<ElectedOfficial>("electedOfficials").findOne({
        officeType: "governor",
        state: stateId,
        characterId: { $ne: null },
      });
    }

    // Fetch characters and NPPs to get sequentialIds (include governor)
    const characterIds = [
      ...officials.filter((o) => !o.isNPP && o.characterId).map((o) => o.characterId!),
      ...(governor?.characterId ? [governor.characterId] : []),
    ];
    const nppIds = officials.filter((o) => o.isNPP && o.nppId).map((o) => o.nppId!);

    const [characters, npps] = await Promise.all([
      characterIds.length > 0
        ? db
            .collection<Character>("characters")
            .find(
              { _id: { $in: characterIds } },
              { projection: { _id: 1, sequentialId: 1, avatarUrl: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      nppIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find(
              { _id: { $in: nppIds } },
              { projection: { _id: 1, sequentialId: 1, avatarUrl: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
    ]);

    const characterDataMap = new Map(
      characters.map((c) => [
        c._id.toString(),
        {
          sequentialId: c.sequentialId,
          avatarUrl: (c as { avatarUrl?: string }).avatarUrl ?? null,
        },
      ])
    );
    const nppDataMap = new Map(
      npps.map((n) => [
        n._id.toString(),
        {
          sequentialId: n.sequentialId,
          avatarUrl: (n as { avatarUrl?: string }).avatarUrl ?? null,
        },
      ])
    );

    return NextResponse.json({
      state: {
        id: state._id,
        name: state.name,
        totalSeats: subNationalChamberSeats(countryId, state, await getGameStatePreset(db)),
        filledSeats,
      },
      composition,
      officials: officials.map((o) => {
        const isNPP = o.isNPP ?? false;
        const data = isNPP
          ? nppDataMap.get(o.nppId?.toString() ?? "")
          : characterDataMap.get(o.characterId?.toString() ?? "");
        const party = partyMap.get(o.party ?? "");
        return {
          id: o._id.toString(),
          characterId: o.characterId?.toString(),
          characterName: o.characterName,
          party: o.party,
          partyName: party?.name,
          partyColor: party?.color,
          countryId,
          seatsHeld: o.seatsHeld ?? 1,
          isNPP,
          nppId: o.nppId?.toString(),
          sequentialId: data?.sequentialId,
          avatarUrl: data?.avatarUrl ?? null,
        };
      }),
      governor: governor
        ? {
            characterId: governor.characterId?.toString(),
            characterName: governor.characterName,
            sequentialId: governor.characterId
              ? characterDataMap.get(governor.characterId.toString())?.sequentialId
              : undefined,
            party: governor.party,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
