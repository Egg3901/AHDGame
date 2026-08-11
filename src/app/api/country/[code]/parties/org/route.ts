/**
 * GET /api/parties/org — Aggregate party organization totals across all states.
 * Public endpoint. Returns sum of organization per party for the org donut chart.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

// GET /api/country/[code]/parties/org — Return aggregate party organization totals across all states
// Auth: public
// Errors: 400
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const db = await getDb();

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const partyFilter = { countryId };
    const orgFilter = { organization: { $gt: 0 }, countryId };

    const [parties, orgRecords] = await Promise.all([
      db
        .collection<PoliticalParty>("politicalParties")
        .find(partyFilter)
        .project({ _id: 1, name: 1, abbreviation: 1, color: 1, sequentialId: 1 })
        .toArray(),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .find(orgFilter)
        .project({ partyId: 1, organization: 1 })
        .toArray(),
    ]);

    // Sum org per party (partyId is stringified sequentialId)
    const totals: Record<string, number> = {};
    for (const rec of orgRecords) {
      totals[rec.partyId] = (totals[rec.partyId] ?? 0) + rec.organization;
    }

    const result = parties
      .map((p) => {
        const seqKey = String(p.sequentialId);
        return {
          id: String(p.sequentialId),
          name: p.name,
          abbreviation: p.abbreviation,
          color: p.color,
          totalOrg: totals[seqKey] ?? 0,
        };
      })
      .filter((p) => p.totalOrg > 0)
      .sort((a, b) => b.totalOrg - a.totalOrg);

    return NextResponse.json({ parties: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
