import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character, NPP, State, PoliticalParty } from "@/lib/db/types";
import { getOfficeLabel } from "@/lib/utils/politics";
import { handleRouteError } from "@/lib/api/errors";

export type PoliticianType = "character" | "npp";

export interface PoliticianProfileData {
  type: PoliticianType;
  id: string;
  name: string;
  avatarUrl?: string;
  party: string;
  partyName?: string;
  homeState: string;
  homeStateName?: string;
  currentOffice: string;
  politicalInfluence: number;
  nationalInfluence?: number;
  favorability?: number;
  infamy?: number;
  policies?: { economic: number; social: number };
  bio?: string;
  isNPP?: boolean;
}

// GET /api/politician/[id] — Returns profile data for a character or NPP by ID, including party and home state info
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const db = await getDb();
    const objectId = new ObjectId(id);

    const character = await db.collection<Character>("characters").findOne({ _id: objectId });
    if (character) {
      const homeState = await db
        .collection<State>("states")
        .findOne({ _id: character.homeState, countryId: character.countryId });
      let party: PoliticalParty | null = null;
      if (character.party && character.party !== "independent") {
        const partySeqId = parseInt(character.party, 10);
        const charCountry = character.countryId ?? "US";
        if (!isNaN(partySeqId)) {
          party = await db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ sequentialId: partySeqId, countryId: charCountry });
        }
      }
      return NextResponse.json({
        type: "character",
        id: character._id.toString(),
        name: character.name,
        avatarUrl: character.avatarUrl ?? undefined,
        party: character.party,
        partyName: party?.name,
        homeState: character.homeState,
        homeStateName: homeState?.name,
        currentOffice: getOfficeLabel(character.currentOffice),
        politicalInfluence: character.politicalInfluence ?? 0,
        nationalInfluence: character.nationalInfluence ?? 0,
        favorability: character.favorability ?? 50,
        infamy: character.infamy ?? 0,
        policies: character.policies ?? { economic: 0, social: 0 },
        bio: character.bio ?? undefined,
        isNPP: false,
      } satisfies PoliticianProfileData);
    }

    const npp = await db.collection<NPP>("npps").findOne({ _id: objectId });
    if (npp) {
      const homeState = await db
        .collection<State>("states")
        .findOne({ _id: npp.homeState, countryId: npp.countryId });
      let party: PoliticalParty | null = null;
      if (npp.party && npp.party !== "independent") {
        const partySeqId = parseInt(npp.party, 10);
        const nppCountry = npp.countryId ?? "US";
        if (!isNaN(partySeqId)) {
          party = await db
            .collection<PoliticalParty>("politicalParties")
            .findOne({ sequentialId: partySeqId, countryId: nppCountry });
        }
      }
      return NextResponse.json({
        type: "npp",
        id: npp._id.toString(),
        name: npp.name,
        avatarUrl: npp.avatarUrl ?? undefined,
        party: npp.party,
        partyName: party?.name,
        homeState: npp.homeState,
        homeStateName: homeState?.name,
        currentOffice: getOfficeLabel(npp.currentOffice),
        politicalInfluence: npp.politicalInfluence ?? 0,
        favorability: npp.favorability ?? 50,
        policies: npp.policies ?? { economic: 0, social: 0 },
        isNPP: true,
      } satisfies PoliticianProfileData);
    }

    return NextResponse.json({ error: "Politician not found" }, { status: 404 });
  } catch (error) {
    return handleRouteError(error);
  }
}
