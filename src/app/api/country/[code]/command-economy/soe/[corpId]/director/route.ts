// POST /api/country/[code]/command-economy/soe/[corpId]/director
// Command Economy v2 (P2) — appoint or reassign an SOE director (the cabinet /
// Supreme Soviet appointment wiring). Writes soe.directorId + soe.directorName.
//
// Auth model:
//  - The Gosplan chair or the head of government may appoint ANY citizen, or
//    clear the seat back to the NPP brain (characterId: null).
//  - A vacant seat may be self-claimed by a citizen of the country.
// Errors: 401/403/404/429.
import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { badRequest, forbidden, handleRouteError, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { Corporation } from "@/lib/db/types/corporation";
import type { Character } from "@/lib/db/types/character";
import { canAppointSoeDirector } from "@/lib/economy/commandEconomyAuth";
import { resolveWriteContext } from "@/lib/economy/queries/commandEconomyWriteContext";

interface RouteContext {
  params: Promise<{ code: string; corpId: string }>;
}

const schema = z.object({
  /** Character to seat; null clears to the NPP brain. Omit to self-claim. */
  characterId: z.string().nullable().optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code, corpId } = await context.params;
    const setup = await resolveWriteContext(code);
    if (!setup.ok) return setup.response;
    const { db, countryId, characterId, characterName, roles } = setup.ctx;

    if (!ObjectId.isValid(corpId)) {
      return NextResponse.json(notFound("Enterprise not found").toJson(), { status: 404 });
    }
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne(
        { _id: new ObjectId(corpId), countryId, soe: { $exists: true } },
        { projection: { _id: 1, soe: 1 } }
      );
    if (!corp?.soe) {
      return NextResponse.json(notFound("Enterprise not found").toJson(), { status: 404 });
    }

    const rate = checkRateLimit(String(characterId), 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const canAppoint = canAppointSoeDirector(roles);
    const seatVacant = !corp.soe.directorId;
    const wantsSelfClaim = parsed.data.characterId === undefined;

    // Resolve the target seat holder.
    let targetId: ObjectId | null;
    let targetName: string | null;
    if (wantsSelfClaim) {
      // Self-claim: only allowed on a vacant seat (appointers may still claim).
      if (!seatVacant && !canAppoint) {
        return NextResponse.json(forbidden("This enterprise already has a director.").toJson(), {
          status: 403,
        });
      }
      targetId = characterId;
      targetName = characterName;
    } else {
      // Explicit (re)assignment or clearing — appointer-only.
      if (!canAppoint) {
        return NextResponse.json(
          forbidden(
            "Only the Gosplan chair or the head of government can appoint directors."
          ).toJson(),
          { status: 403 }
        );
      }
      if (parsed.data.characterId == null) {
        targetId = null;
        targetName = null;
      } else {
        const appointeeCharacterId = parsed.data.characterId;
        if (!ObjectId.isValid(appointeeCharacterId)) {
          return NextResponse.json(badRequest("Invalid character id.").toJson(), { status: 400 });
        }
        const appointee = await db
          .collection<Character>("characters")
          .findOne(
            { _id: new ObjectId(appointeeCharacterId), countryId },
            { projection: { _id: 1, name: 1 } }
          );
        if (!appointee) {
          return NextResponse.json(
            badRequest("That character is not a citizen of this country.").toJson(),
            { status: 400 }
          );
        }
        targetId = appointee._id;
        targetName = appointee.name ?? "Director";
      }
    }

    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: new ObjectId(corpId) },
        { $set: { "soe.directorId": targetId, "soe.directorName": targetName } }
      );

    return NextResponse.json({
      success: true,
      directorId: targetId ? String(targetId) : null,
      directorName: targetName,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
