import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import {
  buildPartyDisciplineAnalytics,
  buildPartySlateAnalytics,
  buildStatePartyOrgAnalytics,
} from "@/lib/partyAnalytics";
import { regionPartyUrl } from "@/lib/urls";

// GET /api/country/[code]/region/[id]/party/[partyId]/analytics — Scoped state-party analytics for org, discipline, and slate
// Auth: requireAuth (party members in-state, national party leadership, or admin only)
// Errors: 400, 401, 403, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string; partyId: string }> }
) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const [state, party] = await Promise.all([
      db.collection<State>("states").findOne({ _id: id, countryId }),
      findPartyBySequentialId(db, partyId, countryId),
    ]);

    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyIdString = String(party.sequentialId);
    const character = auth.user.character;
    const isStatePartyMember =
      !!character && character.party === partyIdString && character.homeState === state._id;
    const characterId = character?._id?.toString() ?? null;
    const isNationalLeadership =
      !!characterId &&
      (characterId === party.chairId?.toString() || characterId === party.viceChairId?.toString());

    if (!auth.user.isAdmin && !isStatePartyMember && !isNationalLeadership) {
      return NextResponse.json(
        { error: "State party analytics are only available to party members" },
        { status: 403 }
      );
    }

    const [org, discipline, slate] = await Promise.all([
      buildStatePartyOrgAnalytics(db, countryId, partyIdString, state._id),
      buildPartyDisciplineAnalytics(db, countryId, partyIdString, state._id),
      buildPartySlateAnalytics(db, countryId, partyIdString, state._id),
    ]);

    const partyHref = regionPartyUrl(countryId, state._id, partyIdString);

    return NextResponse.json({
      scope: {
        stateId: state._id,
        stateName: state.name,
      },
      links: {
        treasury: { label: "Open Treasury", href: `${partyHref}?tab=treasury` },
        slate: { label: "Open Slate", href: `${partyHref}?tab=slate` },
        whipRoom: { label: "Open Whip Room", href: `${partyHref}?tab=whip-room` },
        npps: { label: "Open NPPs", href: `${partyHref}?tab=actions&sub=management` },
        elections: { label: "Open Elections", href: `${partyHref}?tab=elections` },
      },
      org,
      discipline,
      slate: {
        activeRaceCount: slate.activeRaceCount,
        uncoveredRaceCount: slate.uncoveredRaceCount,
        awaitingResolutionCount: slate.awaitingResolutionCount,
        filedCount: slate.filedCount,
        likelyDeclineCount: slate.likelyDeclineCount,
        coverage: slate.stateCoverage[0] ?? null,
        noCoverage: slate.noCoverage,
        atRiskAssignments: slate.atRiskAssignments,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
