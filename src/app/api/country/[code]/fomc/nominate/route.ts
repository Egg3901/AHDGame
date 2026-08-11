/**
 * POST /api/country/[code]/fomc/nominate — the executive nominates a player or
 * NPP politician to a specific FOMC committee seat (optionally the chair). The
 * nomination is Senate-confirmed by `processFomcNominationLifecycle`; on
 * confirmation the nominee is installed into the seat on `centralBanks.fomcBoard`.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, forbidden, badRequest, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { getGameState } from "@/lib/gameState";
import type { CentralBank, FomcNomination } from "@/lib/db/types/centralBank";
import type { Character, NPP } from "@/lib/db/types";
import { FOMC_VOTE_WINDOW_TURNS, FOMC_PLAYER_VOTE_WINDOW_MS } from "@/lib/db/types/centralBank";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z
  .object({
    seatId: z.string().min(1),
    alignment: z.enum(["hawk", "dove"]),
    makeChair: z.boolean().optional(),
    nomineeCharacterId: schemas.objectId.optional(),
    nomineeNppId: schemas.objectId.optional(),
  })
  .refine((v) => Boolean(v.nomineeCharacterId) !== Boolean(v.nomineeNppId), {
    message: "Provide exactly one of nomineeCharacterId or nomineeNppId",
  });

export async function POST(request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const rateLimit = checkRateLimit(`fomc-nominate:${auth.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const { bankId, memberCountries } = await getCentralBankScope(db, countryId);

    // Caller must be the executive of a member country of this bank.
    const callerCountryId = auth.character.countryId as CountryId;
    const execOffice = COUNTRY_CONFIGS[callerCountryId]?.officeTypes.find((o) => o.isExecutive);
    const callerOffice = auth.character.currentOffice;
    if (
      !execOffice ||
      !memberCountries.includes(callerCountryId) ||
      !callerOffice ||
      callerOffice.type !== execOffice.key
    )
      return NextResponse.json(forbidden().toJson(), { status: 403 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const body = parsed.data;

    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
    if (!bank?.fomcBoard)
      return NextResponse.json(notFound("Committee not found").toJson(), { status: 404 });
    if (!bank.fomcBoard.some((s) => s.seatId === body.seatId))
      return NextResponse.json(badRequest("Unknown seat").toJson(), { status: 400 });

    // One active nomination per seat at a time.
    const existing = await db
      .collection<FomcNomination>("fomcNominations")
      .findOne({ bankId, seatId: body.seatId, status: "active" });
    if (existing)
      return NextResponse.json(
        badRequest("A nomination for this seat is already before the Senate").toJson(),
        { status: 400 }
      );

    // Resolve the nominee's display name + party.
    const nomineeCharacterId = body.nomineeCharacterId
      ? new ObjectId(body.nomineeCharacterId)
      : null;
    const nomineeNppId = body.nomineeNppId ? new ObjectId(body.nomineeNppId) : null;
    let occupantType: "player" | "npp";
    let nomineeName: string;
    let nomineeParty: string | undefined;
    if (nomineeCharacterId) {
      const char = await db
        .collection<Character>("characters")
        .findOne({ _id: nomineeCharacterId });
      if (!char) return NextResponse.json(notFound("Nominee not found").toJson(), { status: 404 });
      occupantType = "player";
      nomineeName = char.name;
      nomineeParty = char.party;
    } else {
      const npp = await db.collection<NPP>("npps").findOne({ _id: nomineeNppId! });
      if (!npp) return NextResponse.json(notFound("Nominee not found").toJson(), { status: 404 });
      occupantType = "npp";
      nomineeName = npp.name;
      nomineeParty = npp.party;
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const now = new Date();

    const nomination: Omit<FomcNomination, "_id"> = {
      countryId,
      bankId,
      seatId: body.seatId,
      makeChair: body.makeChair ?? false,
      nomineeCharacterId,
      nomineeNppId,
      nomineeName,
      nomineeParty,
      occupantType,
      alignment: body.alignment,
      proposedByPresidentId: auth.character._id,
      proposedByPresidentName: auth.character.name,
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      votingStartedAt: now,
      votingEndsOnTurn: currentTurn + FOMC_VOTE_WINDOW_TURNS,
      iteration: gameState?.iteration,
      proposedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const insert = await db
      .collection<FomcNomination>("fomcNominations")
      .insertOne({ _id: new ObjectId(), ...nomination } as FomcNomination);

    return NextResponse.json({
      ok: true,
      nominationId: insert.insertedId.toString(),
      votingEndsOnTurn: nomination.votingEndsOnTurn,
      votingEndsAt: new Date(now.getTime() + FOMC_PLAYER_VOTE_WINDOW_MS).toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
