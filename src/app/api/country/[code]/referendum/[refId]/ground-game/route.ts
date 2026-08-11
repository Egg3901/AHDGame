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
import { canSpendOnStateParty } from "@/lib/parties/access";
import { spendGroundGame } from "@/lib/referendum/groundGame";

// POST /api/country/[code]/referendum/[refId]/ground-game
// Auth: requireHumanSessionWithCharacter; nation-gated (the acting character must
//   belong to the referendum's country). Official mode requires the actor be a
//   party Chair/Vice/Campaigner (canSpendOnStateParty) and debits Political
//   Strength; volunteer mode debits the player's Actions + Campaign Funds.
//   UK-only. Errors: 400, 401, 403, 404.
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
        side: z.union([z.literal("yes"), z.literal("no")]),
        presetId: z.string().min(1),
        target: z.union([z.literal("whole"), z.object({ groupId: z.string().min(1) })]),
        mode: z.union([z.literal("official"), z.literal("volunteer")]),
      })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const ref = await getReferendumCollection(db).findOne({ _id: new ObjectId(refId) });
    if (!ref) return NextResponse.json({ error: "Referendum not found." }, { status: 404 });

    // Nation gate — no foreign actors, either mode.
    if (auth.user.character.countryId !== ref.countryId) {
      return NextResponse.json(
        { error: "Only players of this nation may campaign in this referendum." },
        { status: 403 }
      );
    }

    const partyId = auth.user.character.party ?? null;
    // Wire display name: party abbreviation (official) or the player's name.
    let actorName = auth.user.character.name ?? "A volunteer";
    if (parsed.data.mode === "official") {
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
      if (!partyDoc || !canSpendOnStateParty(partyDoc, stateParty, auth.user)) {
        return NextResponse.json(
          { error: "Only a party officer may run an official ground game." },
          { status: 403 }
        );
      }
      actorName = partyDoc.abbreviation;
    }

    const result = await spendGroundGame(db, {
      referendumId: refId,
      side: parsed.data.side,
      presetId: parsed.data.presetId,
      target: parsed.data.target,
      mode: parsed.data.mode,
      characterId: auth.user.character._id,
      partyId: parsed.data.mode === "official" ? String(partyId) : undefined,
      countryId,
      actorName,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
