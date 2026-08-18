// GET /api/admin/economy/npps
// Returns all active NPPs with economy fields (funds, actionPoints, donorBaseLevel)
// joined with party names. Used by NppEconomyAdminPanel.
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { NPP, PoliticalParty } from "@/lib/db/types";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const [npps, parties] = await Promise.all([
      db
        .collection<NPP>("npps")
        .find(
          { retiredAt: null },
          {
            projection: {
              name: 1,
              countryId: 1,
              party: 1,
              homeState: 1,
              currentOffice: 1,
              funds: 1,
              actionPoints: 1,
              donorBaseLevel: 1,
              lastActionProcessedTurn: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<PoliticalParty>("politicalParties")
        .find({}, { projection: { name: 1, sequentialId: 1, countryId: 1 } })
        .toArray(),
    ]);

    // Build party name map keyed by countryId:sequentialId (same as admin/npps route)
    const partyMap = new Map<string, string>();
    for (const p of parties) {
      partyMap.set(`${p.countryId}:${p.sequentialId}`, p.name);
    }

    const rows = npps.map((npp) => ({
      id: npp._id.toString(),
      name: npp.name,
      countryId: npp.countryId,
      party:
        partyMap.get(`${npp.countryId}:${npp.party}`) ??
        (npp.party === "independent" ? "Independent" : `Party ${npp.party}`),
      homeState: npp.homeState,
      currentOffice: npp.currentOffice ?? null,
      funds: npp.funds ?? 0,
      actionPoints: npp.actionPoints ?? 0,
      donorBaseLevel: npp.donorBaseLevel ?? 0,
      lastActionProcessedTurn: npp.lastActionProcessedTurn,
    }));

    return NextResponse.json({ npps: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}
