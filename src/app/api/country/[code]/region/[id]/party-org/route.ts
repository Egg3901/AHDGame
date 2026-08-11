import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { StatePartyOrg, PoliticalParty, State } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { getPartyIdString } from "@/lib/db/partyLookup";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/region/[id]/party-org — Return organization data for all parties in a region
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

    // Fetch parties filtered by country to avoid cross-country sequential ID
    // collisions. Exclude defunct (merged-away) parties — their tombstone is
    // retained for history but must not appear as an active org-building party.
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId, isDefunct: { $ne: true } })
      .sort({ isDefault: -1, memberCount: -1, name: 1 })
      .toArray();

    // Fetch existing party org records for this state
    const existingPartyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ stateId })
      .toArray();

    // Create a map for quick lookup of existing org records
    const orgMap = new Map(existingPartyOrg.map((po) => [po.partyId, po]));

    // Build result for all parties, defaulting to 0 for those without records
    const result = parties.map((party) => {
      const partyIdStr = getPartyIdString(party);
      const existingOrg = orgMap.get(partyIdStr);

      if (existingOrg) {
        return {
          _id: existingOrg._id,
          stateId: existingOrg.stateId,
          partyId: existingOrg.partyId,
          organization: existingOrg.organization,
          partyName: party.name,
          partyAbbreviation: party.abbreviation,
          partyColor: getPartyHex(partyIdStr, party.color),
        };
      }

      // Party has no org record - return default values
      return {
        _id: `${stateId}_${partyIdStr}`,
        stateId,
        partyId: partyIdStr,
        organization: 0,
        partyName: party.name,
        partyAbbreviation: party.abbreviation,
        partyColor: party.color,
      };
    });

    return NextResponse.json({
      stateId,
      stateName: state.name,
      partyOrg: result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
