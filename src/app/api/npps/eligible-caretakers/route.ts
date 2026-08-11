/**
 * GET /api/npps/eligible-caretakers?country=US — list NPPs a player may appoint
 * as a caretaker (minister or CEO) in `country`.
 *
 * Eligible = active (not retired) NPP in the country that does not already hold a
 * cabinet seat or run a corporation, so it is free to take one. Used by the
 * caretaker-appointment pickers (NPP-autonomy V2.1). Auth: requireBasicAuth.
 */

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation, NPP } from "@/lib/db/types";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";

export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const raw = new URL(request.url).searchParams.get("country");
    const countryId = (raw ?? "US").toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }

    const db = await getDb();

    // Only meaningful where caretakers can act (v2 in player countries).
    if (!(await nppAutonomyAtLeast(db, countryId, "v2"))) {
      return NextResponse.json({ eligible: [], enabled: false });
    }

    // NPPs already committed elsewhere: cabinet seats + corp CEOs in this country.
    const [seated, ceoCorps] = await Promise.all([
      db
        .collection<UnifiedCabinetMember>("cabinetMembers")
        .find({ isNPP: true })
        .project<{ nppId?: NPP["_id"] }>({ nppId: 1 })
        .toArray(),
      db
        .collection<Corporation>("corporations")
        .find({ ceoType: "npp" })
        .project<{ ceoId?: NPP["_id"] }>({ ceoId: 1 })
        .toArray(),
    ]);
    const committed = new Set<string>([
      ...seated.map((s) => s.nppId?.toString()).filter((x): x is string => !!x),
      ...ceoCorps.map((c) => c.ceoId?.toString()).filter((x): x is string => !!x),
    ]);

    const npps = await db
      .collection<NPP>("npps")
      .find({ countryId, retiredAt: null })
      .project<{ _id: NPP["_id"]; name: string; party: string; politicalInfluence?: number }>({
        _id: 1,
        name: 1,
        party: 1,
        politicalInfluence: 1,
      })
      .toArray();

    const eligible = npps
      .filter((n) => !committed.has(n._id.toString()))
      .map((n) => ({
        id: n._id.toString(),
        name: n.name,
        party: n.party,
        influence: n.politicalInfluence ?? 0,
      }))
      .sort((a, b) => b.influence - a.influence)
      .slice(0, 50);

    return NextResponse.json({ eligible, enabled: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
