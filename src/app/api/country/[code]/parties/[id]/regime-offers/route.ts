/**
 * GET /api/country/[code]/parties/[id]/regime-offers
 *
 * Read-only inbox feed for a specific party — surfaces regime-level
 * notifications addressed to this party (currently: Stage-2 selective-
 * concession legalization events).
 *
 * Sources from the existing `countryHistory` feed filtered by
 * `eventType: "regime_escalation"` + `party === sequentialId`. No new
 * collection — the regime-history feed is the source of truth.
 *
 * Info-asymmetry guard: this endpoint does NOT include the ruling-
 * party leader's diagnostic scalars. Only the events tagged with this
 * partyId are returned.
 *
 * No auth — party pages are public. Errors:
 *   400 — invalid country / invalid partyId
 *   500 — anything else
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryHistoryCollection } from "@/lib/db/collections/countryHistory";

const MAX_OFFERS = 20;

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    // id can be either a sequentialId number or an ObjectId hex. The party
    // field on countryHistory is the sequentialId-as-string, so the inbox
    // filter accepts the number-string form. Treat anything that's not a
    // pure integer string as 400.
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: "Party id must be a sequentialId" }, { status: 400 });
    }

    const db = await getDb();
    const coll = await getCountryHistoryCollection(db);
    const rows = await coll
      .find({
        countryId,
        eventType: "regime_escalation",
        party: id,
      })
      .sort({ turn: -1 })
      .limit(MAX_OFFERS)
      .toArray();

    return NextResponse.json({
      countryId,
      partyId: id,
      offers: rows.map((r) => ({
        turn: r.turn,
        title: r.title,
        at: r.timestamp,
        subtype: (r.details as { subtype?: string } | undefined)?.subtype ?? null,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
