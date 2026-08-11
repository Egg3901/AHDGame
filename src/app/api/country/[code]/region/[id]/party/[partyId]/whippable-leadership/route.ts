import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import type { BillWhip, CabinetNomination, ElectedOfficial, StatePartyOrg } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetWhipChamber } from "@/lib/partyWhips/constraints";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import { getGameState } from "@/lib/gameState";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

interface LeadershipItem {
  id: string;
  type: string;
  candidacies: Array<{
    id: string;
    nomineeName: string;
    nomineeParty?: string;
    votesFor: number;
  }>;
  existingWhips: Array<{ candidacyId?: string; attemptNumber: number }>;
  canWhip: boolean;
}

// GET /api/country/[code]/region/[id]/party/[partyId]/whippable-leadership — Return cabinet nominations that this state party's NPPs can be whipped on
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: stateId, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const authData = auth.user;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyKey = getPartyIdString(party);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const statePartyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });

    if (!statePartyOrg) {
      return NextResponse.json({ error: "State party organization not found" }, { status: 404 });
    }

    const characterId = authData.character._id;
    const isChair = statePartyOrg.chairId?.equals(characterId);
    const isViceChair = statePartyOrg.viceChairId?.equals(characterId);
    const isAdmin = authData.isAdmin;

    if (!isChair && !isViceChair && !isAdmin) {
      return NextResponse.json(
        { error: "Only the State Party Chair or Vice Chair can view whippable targets" },
        { status: 403 }
      );
    }

    const cabinetChamber = getCabinetWhipChamber(countryId);
    const eligibleOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        isNPP: true,
        party: partyKey,
        state: stateId,
        // CN: chamber key "npc" → office type "npcDelegate" (no-op elsewhere).
        officeType: getOfficeTypeForChamber(countryId, cabinetChamber),
      })
      .toArray();

    if (eligibleOfficials.length === 0) {
      return NextResponse.json({
        speakerElections: [],
        leadershipElections: [],
      });
    }

    const now = new Date();
    const gameStateForLeadership = await getGameState(db);
    const currentTurnForLeadership = gameStateForLeadership?.currentTurn ?? 0;
    const nominations = await db
      .collection<CabinetNomination>("cabinetNominations")
      .find({ status: "active", countryId })
      .toArray();
    const activeNominations = nominations.filter(
      (nomination) =>
        !isVotingDeadlinePassed(
          nomination.votingEndsAt,
          now,
          nomination.votingEndsOnTurn,
          currentTurnForLeadership
        )
    );

    if (activeNominations.length === 0) {
      return NextResponse.json({
        speakerElections: [],
        leadershipElections: [],
      });
    }

    const existingWhips = await db
      .collection<BillWhip>("billWhips")
      .find({
        targetType: "cabinetNomination",
        targetId: { $in: activeNominations.map((nomination) => nomination._id) },
        chamber: cabinetChamber,
        partyId: partyKey,
        stateId,
      })
      .toArray();

    const whipsByNomination = new Map<string, BillWhip[]>();
    for (const whip of existingWhips) {
      const key = whip.targetId.toString();
      if (!whipsByNomination.has(key)) {
        whipsByNomination.set(key, []);
      }
      whipsByNomination.get(key)!.push(whip);
    }

    const items: LeadershipItem[] = activeNominations.map((nomination) => {
      const whips = whipsByNomination.get(nomination._id.toString()) ?? [];
      return {
        id: nomination._id.toString(),
        type: `Cabinet: ${nomination.nomineeCharacterName}`,
        candidacies: [],
        existingWhips: whips.map((whip) => ({
          candidacyId: whip.candidacyId?.toString(),
          attemptNumber: whip.attemptNumber,
        })),
        canWhip: whips.length < 2,
      };
    });

    return NextResponse.json({
      speakerElections: [],
      leadershipElections: items,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
