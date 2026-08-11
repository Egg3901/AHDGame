/**
 * GET /api/country/[code]/legislature/presiding-officers — chamber presiding
 * officers (Speaker of the lower house, President of the upper house) for
 * presidential legislatures. Resolves character- OR NPP-backed holders via the
 * shared executive resolver; returns null (Vacant) when unseeded. Country-scoped;
 * does not touch the parliamentary /leaders route.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import { resolveExecutiveHolder } from "@/lib/elections/resolveExecutiveHolder";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const db = await getDb();
    const officials = db.collection<ElectedOfficial>("electedOfficials");
    const [speakerOfficial, senatePresidentOfficial] = await Promise.all([
      officials.findOne({ countryId, officeType: "speaker" }),
      officials.findOne({ countryId, officeType: "senatePresident" }),
    ]);
    const [speaker, senatePresident] = await Promise.all([
      resolveExecutiveHolder(db, speakerOfficial),
      resolveExecutiveHolder(db, senatePresidentOfficial),
    ]);
    return NextResponse.json({ speaker, senatePresident });
  } catch (error) {
    return handleRouteError(error);
  }
}
