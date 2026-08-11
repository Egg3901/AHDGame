/**
 * GET /api/whitehouse/cabinet/characters — Player characters for nomination dropdown (President only)
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import { resolvePresidentialCountry } from "@/lib/executive/presidentialCountry";

// GET /api/whitehouse/cabinet/characters — Returns US player characters for the cabinet nomination dropdown (President only).
// Auth: requireBasicAuth
// Errors: 400, 401, 403
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const countryId = resolvePresidentialCountry(request);
    if (!countryId) {
      return NextResponse.json({ error: "Unknown country" }, { status: 400 });
    }

    const db = await getDb();

    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "president", characterId: { $ne: null } });
    if (!presidentOfficial?.characterId) {
      return NextResponse.json({ error: "No President in office" }, { status: 400 });
    }

    const myCharacter = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!myCharacter || !presidentOfficial.characterId.equals(myCharacter._id)) {
      return NextResponse.json(
        { error: "Only the President can nominate cabinet members" },
        { status: 403 }
      );
    }

    // Only same-country characters can be nominated to this cabinet
    const characters = await db
      .collection<Character>("characters")
      .find({ userId: { $exists: true }, countryId })
      .project({ _id: 1, name: 1, party: 1, homeState: 1, currentOffice: 1 })
      .sort({ name: 1 })
      .toArray();

    return NextResponse.json({
      characters: characters.map((c) => ({
        _id: c._id.toString(),
        name: c.name,
        party: c.party,
        homeState: c.homeState,
        currentOffice: c.currentOffice,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
