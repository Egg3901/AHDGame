import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { draftCharterSchema } from "@/lib/api/schemas/charters";
import { draftCharter } from "@/lib/charters/draftCharter";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { Character, PartyCharter, PartyCharterStatus } from "@/lib/db/types";

function draftCharterErrorMessage(reason: string): string {
  switch (reason) {
    case "founders-not-3":
      return "Exactly 3 founders required";
    case "founders-not-unique":
      return "Founders must be 3 distinct characters";
    case "proposer-not-founder":
      return "Proposer must be one of the founders";
    case "founder-not-found":
      return "One of the founders refers to a character that doesn't exist";
    case "founder-not-human":
      return "All founders must be human-owned characters";
    case "founder-wrong-country":
      return "All founders must belong to the same country as this charter";
    case "founder-not-adjacent":
      return "Co-founders must live in the proposer's home state or a state adjacent to it";
    case "cohort-state-not-adjacent":
      return "Founding-cohort states must be the proposer's home state or adjacent to it";
    case "name-taken":
      return "A party or active charter already uses this name";
    case "abbreviation-taken":
      return "A party or active charter already uses this abbreviation";
    default:
      return "Failed to draft charter";
  }
}

/**
 * GET /api/charters?countryId=US&me=true&status=pending-signatures
 *
 * Lists charters with optional filters:
 *  - `countryId` (required for unauthenticated reads in MVP we still require auth)
 *  - `me=true` — only charters where any of the caller's characters is a founder
 *  - `status` — single status filter (e.g. `pending-signatures`)
 *
 * Auth: requireAuthWithCharacter
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const countryRaw = url.searchParams.get("countryId");
    const me = url.searchParams.get("me") === "true";
    const status = url.searchParams.get("status") as PartyCharterStatus | null;

    const filter: Record<string, unknown> = {};
    if (countryRaw) {
      const cid = countryRaw.toUpperCase();
      if (!COUNTRY_CONFIGS[cid as CountryId]) {
        return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
      }
      filter.countryId = cid;
    }
    const db = await getDb();
    if (me) {
      // Resolve the session userId → all owned character ids → match any.
      const ownedCharacterIds = (
        await db
          .collection<Character>("characters")
          .find({ userId: new ObjectId(auth.user.userId) })
          .project<{ _id: ObjectId }>({ _id: 1 })
          .toArray()
      ).map((c) => c._id);
      filter.foundersCharacterIds = { $in: ownedCharacterIds };
    }
    if (status) {
      filter.status = status;
    }

    const charters = await db
      .collection<PartyCharter>("partyCharters")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return NextResponse.json({
      charters: charters.map((c) => ({
        id: c._id.toString(),
        countryId: c.countryId,
        partyId: c.partyId,
        proposedName: c.proposedName,
        proposedAbbr: c.proposedAbbr,
        foundersCharacterIds: c.foundersCharacterIds.map((u) => u.toString()),
        pendingFounderSlots: c.pendingFounderSlots,
        platform: c.platform,
        signatures: c.signatures.map((s) => ({
          characterId: s.characterId.toString(),
          signedAt: s.signedAt?.toISOString(),
          rejectedAt: s.rejectedAt?.toISOString(),
          rejectionReason: s.rejectionReason,
        })),
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        expiresAt: c.expiresAt?.toISOString() ?? null,
        ratifiedAt: c.ratifiedAt?.toISOString(),
        founderReplacementDeadline: c.founderReplacementDeadline?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/charters
 *
 * Creates a charter draft. The caller's active character is treated as
 * the proposer and must be one of the three listed `foundersCharacterIds`
 * (auto-signs the proposer's slot).
 *
 * Auth: requireAuthWithCharacter
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`charter-draft:${auth.user.userId}`, 5, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, draftCharterSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { name, abbreviation, platform, foundersCharacterIds, foundingCohort } = parsed.data;
    const proposerCharacterId = auth.user.character._id;

    const db = await getDb();
    const founderObjectIds = foundersCharacterIds.map((id) => new ObjectId(id));
    const result = await draftCharter(
      {
        countryId: auth.user.character.countryId,
        proposedName: name,
        proposedAbbr: abbreviation,
        platform,
        foundersCharacterIds: founderObjectIds,
        proposedBy: proposerCharacterId,
        foundingCohort,
      },
      db
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: draftCharterErrorMessage(result.reason), reason: result.reason },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        charterId: result.charterId.toString(),
        redirectTo: `/charters/${result.charterId.toString()}`,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
