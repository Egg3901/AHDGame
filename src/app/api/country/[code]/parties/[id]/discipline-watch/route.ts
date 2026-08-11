import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, getOfficeTypeConfig, type CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types";

/**
 * Discipline Watch — chair surface listing NPPs in this party with low loyalty
 * (below 40 by default). Surfaces the same `personality.loyalty` value the
 * cross-pressure resolver reads, so what the chair sees here lines up with
 * vote behaviour on the Bill Vote Prediction page.
 */

const LOW_LOYALTY_THRESHOLD = 40;

function formatCurrentOfficeLabel(npp: NPP, countryId: CountryId): string | null {
  if (!npp.currentOffice) return null;
  const officeConfig = getOfficeTypeConfig(countryId, npp.currentOffice.type);
  return officeConfig?.label ?? npp.currentOffice.type;
}

// GET /api/country/[code]/parties/[id]/discipline-watch — Low-loyalty NPPs flagged for chair attention
// Auth: requireAuth
// Query: ?threshold=<0-100> (defaults to 40)
// Errors: 400, 401, 404
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

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });
    const partyId = String(party.sequentialId);

    const url = new URL(request.url);
    const thresholdRaw = url.searchParams.get("threshold");
    const threshold =
      thresholdRaw && Number.isFinite(Number(thresholdRaw))
        ? Math.max(0, Math.min(100, Number(thresholdRaw)))
        : LOW_LOYALTY_THRESHOLD;

    const npps = await db
      .collection<NPP>("npps")
      .find({
        countryId,
        party: partyId,
        retiredAt: null,
        "personality.loyalty": { $lt: threshold },
      })
      .sort({ "personality.loyalty": 1 })
      .limit(50)
      .toArray();

    return NextResponse.json({
      threshold,
      items: npps.map((n) => ({
        id: n._id.toString(),
        sequentialId: n.sequentialId ?? null,
        name: n.name,
        homeState: n.homeState,
        currentOffice: formatCurrentOfficeLabel(n, countryId),
        loyalty: n.personality?.loyalty ?? 0,
        ambition: n.personality?.ambition ?? 0,
        stubbornness: n.personality?.stubbornness ?? 0,
        factionId: n.factionId?.toString() ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
