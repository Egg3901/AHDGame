import { NextResponse } from "next/server";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";

// GET /api/country/[code]/referendum
// Returns in-flight UK referendums (awaiting the PM's decision, campaigning, or
// in their conversion window) plus the viewer's capabilities (PM / admin /
// campaign side + spend eligibility), so the national surface can render the
// grant / campaign / convert-or-block controls.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (countryId !== "UK") {
      return NextResponse.json({ referendums: [], isPM: false, isAdmin: false, currentTurn: 0 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const viewerId = String(auth.user.character._id);

    const pending = await getReferendumCollection(db)
      .find({ countryId, status: { $in: ["requested", "granted", "campaigning", "actuating"] } })
      .sort({ requestedTurn: 1 })
      .toArray();
    const isAdmin = auth.user.isAdmin === true;

    const [pmId, currentTurn] = await Promise.all([
      getHeadOfGovernmentCharacterId(db, countryId),
      getCurrentTurn(db),
    ]);
    const isPM = pmId != null && String(pmId) === viewerId;

    // Current independence/reunification desire per region (0–100), so the card
    // can show the sentiment driving each request.
    const regionIds = [...new Set(pending.map((r) => r.regionId))];
    const metricDocs = regionIds.length
      ? await db
          .collection<MacroMetricsDoc>("macroMetrics")
          .find({ _id: { $in: regionIds } }, { projection: { "independenceDesire.value": 1 } })
          .toArray()
      : [];
    const desireByRegion = new Map(
      metricDocs.map((m) => [m._id, m.independenceDesire?.value ?? null])
    );

    const referendums = pending.map((r) => ({
      id: String(r._id),
      regionId: r.regionId,
      kind: r.kind,
      status: r.status,
      campaignCloseTurn: r.campaignCloseTurn,
      conversionDeadlineTurn: r.conversionDeadlineTurn,
      yesShare: r.yesShare,
      desire: desireByRegion.get(r.regionId) ?? null,
    }));

    return NextResponse.json({ referendums, isPM, isAdmin, currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
