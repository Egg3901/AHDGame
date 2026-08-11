import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { canDeclarePartyPosition } from "@/lib/parties/access";
import { declarePartyPosition, withdrawPartyPosition } from "@/lib/referendum/partyPositions";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

// POST /api/country/[code]/referendum/[refId]/position
// Auth: requireHumanSessionWithCharacter; must be the acting party's regional or
//   national Chair/Vice (canDeclarePartyPosition). Declares/withdraws the party's
//   public stance during the campaign. UK-only. Errors: 400, 401, 403, 404.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; refId: string }> }
) {
  try {
    const { code, refId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (countryId !== "UK") {
      return NextResponse.json({ error: "Referendums are UK-only." }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(
      request,
      z.object({
        action: z.union([z.literal("declare"), z.literal("withdraw")]),
        side: z.union([z.literal("yes"), z.literal("no")]).optional(),
      })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (parsed.data.action === "declare" && !parsed.data.side) {
      return NextResponse.json({ error: "Pick a side." }, { status: 400 });
    }

    const db = await getDb();
    const ref = await getReferendumCollection(db).findOne({ _id: new ObjectId(refId) });
    if (!ref) return NextResponse.json({ error: "Referendum not found." }, { status: 404 });

    const partyId = auth.user.character.party ?? null;
    if (!partyId) {
      return NextResponse.json({ error: "You are not in a party." }, { status: 400 });
    }
    const [partyDoc, stateParty] = await Promise.all([
      db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ countryId, sequentialId: Number(partyId) }),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .findOne({ countryId, stateId: ref.regionId, partyId: String(partyId) }),
    ]);
    if (!partyDoc) {
      return NextResponse.json({ error: "Party not found." }, { status: 400 });
    }
    if (!canDeclarePartyPosition(partyDoc, stateParty, auth.user)) {
      return NextResponse.json(
        { error: "Only a party Chair or Vice-chair may declare a position." },
        { status: 403 }
      );
    }

    const turn = await getCurrentTurn(db);
    const actorName = partyDoc.abbreviation;
    const result =
      parsed.data.action === "withdraw"
        ? await withdrawPartyPosition(db, {
            referendumId: refId,
            partyId: String(partyId),
            turn,
            actorName,
          })
        : await declarePartyPosition(db, {
            referendumId: refId,
            partyId: String(partyId),
            side: parsed.data.side!,
            declaredByCharacterId: auth.user.character._id,
            turn,
            actorName,
          });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
