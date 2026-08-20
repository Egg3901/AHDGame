import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { replaceFounderSchema } from "@/lib/api/schemas/charters";
import { replaceFounder } from "@/lib/charters/replaceFounder";
import type { Character, PartyCharter } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/charters/[id]/replace-founder — Swaps a founder slot with a fresh
 * characterId and returns the charter to `pending-signatures`. Works both for
 * a voided founder (rejected / banned / withdrawn, status
 * `founder-replacement`) and, per suggestion #287, for a voluntary swap of an
 * inactive UNSIGNED founder while the charter is still `pending-signatures`.
 *
 * Authorization: caller must own at least one of the current founder
 * characters (the surviving founders OR the outgoing founder themselves
 * — self-replacement is allowed when a player wants to hand their slot
 * over).
 *
 * Auth: requireAuthWithCharacter
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`charter-replace:${auth.user.userId}`, 5, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid charter ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, replaceFounderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const charterObjectId = new ObjectId(id);
    const outgoing = new ObjectId(parsed.data.outgoingCharacterId);
    const replacement = new ObjectId(parsed.data.replacementCharacterId);
    const callerUserId = new ObjectId(auth.user.userId);

    const db = await getDb();

    // Authorization: caller must own at least one founder character on
    // the charter (surviving founder OR outgoing founder themselves).
    const charter = await db
      .collection<PartyCharter>("partyCharters")
      .findOne({ _id: charterObjectId });
    if (!charter) {
      return NextResponse.json({ error: "Charter not found" }, { status: 404 });
    }
    const callerCharacters = await db
      .collection<Character>("characters")
      .find({ userId: callerUserId, _id: { $in: charter.foundersCharacterIds } })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .toArray();
    if (callerCharacters.length === 0) {
      return NextResponse.json(
        { error: "Only listed founders (or their owner) can replace a slot" },
        { status: 403 }
      );
    }

    const result = await replaceFounder(charterObjectId, outgoing, replacement, db);

    if (!result.ok) {
      const status = result.reason === "charter-not-found" ? 404 : 400;
      const message =
        result.reason === "charter-not-found"
          ? "Charter not found"
          : result.reason === "not-replaceable"
            ? "Charter is not accepting founder replacements right now"
            : result.reason === "outgoing-not-founder"
              ? "Outgoing character is not a founder on this charter"
              : result.reason === "outgoing-already-signed"
                ? "That founder has already signed and cannot be swapped out"
                : result.reason === "replacement-already-founder"
                  ? "Replacement character is already a founder on this charter"
                  : result.reason === "replacement-not-found"
                    ? "Replacement character does not exist"
                    : result.reason === "replacement-not-human"
                      ? "Replacement must be a human-owned character"
                      : result.reason === "replacement-not-adjacent"
                        ? "Replacement must live in the anchor founder's home state or a state adjacent to it"
                        : "Replacement character must belong to the charter's country";
      return NextResponse.json({ error: message, reason: result.reason }, { status });
    }

    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
