/**
 * GET /api/whitehouse/bills — Bills awaiting presidential action (enrolled)
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Bill, ElectedOfficial } from "@/lib/db/types";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";

// GET /api/whitehouse/bills — Returns enrolled bills awaiting presidential action (President only).
// Country-scoped via ?country= (default US).
// Auth: requireAuth
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    const countryId = resolvePresidentialCountry(request);
    if (!countryId) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ officeType: "president", countryId, characterId: { $ne: null } });
    if (!presidentOfficial?.characterId) {
      return NextResponse.json({ bills: [], isPresident: false });
    }

    const myCharacter = auth.user.character;
    const isPresident = !!myCharacter && presidentOfficial.characterId.equals(myCharacter._id);

    if (!isPresident) {
      return NextResponse.json({ bills: [], isPresident: false });
    }

    const bills = await db
      .collection<Bill>("bills")
      .find({ status: "enrolled", countryId })
      .sort({ sentToPresidentAt: 1 })
      .limit(20)
      .toArray();

    return NextResponse.json({
      bills: bills.map((b) => ({
        id: b._id.toString(),
        title: b.title,
        summary: b.summary,
        sentToPresidentAt: b.sentToPresidentAt?.toISOString() ?? null,
        presidentActionDeadline: b.presidentActionDeadline?.toISOString() ?? null,
      })),
      isPresident: true,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
