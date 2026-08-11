// POST /api/country/[code]/international-organizations/[orgId]/influence
// Foreign minister of `code` (a current member) spends the organization's pooled
// fund to pull a nation toward that org's alignment pole. The play is queued and
// resolved by the alignment turn phase, so it lands under the same per-nation
// cap, non-aligned resistance and locked gate as ordinary drift.
import { z } from "zod";
import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { loadOrganizationDef, isMember } from "@/lib/internationalOrganizations/service";
import {
  commitInfluencePlay,
  type CommitPlayFailure,
} from "@/lib/alignment/commands/commitInfluencePlay";
import type { GameState } from "@/lib/db/types";
import { resolveGameYear } from "@/lib/era/era";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

const influenceSchema = z.object({
  targetEntityId: z.string().min(1).max(8),
  amountLocal: z.number().positive().max(1e15),
});

/** Player-facing copy for each refusal. Never blame the player for a closed gate. */
const FAILURE_MESSAGE: Record<CommitPlayFailure, string> = {
  "gate-off": "Bloc influence is not enabled in this world.",
  "no-channel": "This organization carries no influence in the current era.",
  "unknown-target": "That nation has no alignment on record.",
  "target-locked": "That nation is locked to its bloc — influence cannot move it.",
  "unknown-target-economy":
    "That nation's economy is not on record, so the cost of influencing it cannot be priced.",
  "insufficient-funds": "The organization's fund does not hold that much.",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; orgId: string }> }
) {
  try {
    const { code, orgId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }

    const body = await parseJsonBody(request, influenceSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rl = checkRateLimit(`org-influence:${ip}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    const orgDef = await loadOrganizationDef(db, orgId);
    if (!orgDef) {
      return NextResponse.json(badRequest("Unknown organization").toJson(), { status: 400 });
    }

    const fm = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!fm.ok) return fm.response;

    // Everything downstream uses the def's canonical id, never the raw URL
    // segment, so a differently-cased path can never resolve an org here and
    // then miss its alignment channel there.
    const organizationId = orgDef.id;

    if (!(await isMember(db, organizationId, countryId))) {
      return NextResponse.json(
        badRequest(`${countryId} is not a member of ${organizationId}.`).toJson(),
        { status: 400 }
      );
    }

    // Read the clock here so the command stays free of clock lookups and is
    // trivially testable.
    const gs = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1, startingYear: 1 } });
    const year = (gs ? resolveGameYear(gs) : null) ?? new Date().getFullYear();
    const turn = await getCurrentTurn(db);

    const result = await commitInfluencePlay({
      db,
      organizationId,
      sponsorCountryId: countryId,
      targetEntityId: body.data.targetEntityId.toUpperCase(),
      amountLocal: body.data.amountLocal,
      turn,
      year,
    });

    if (!result.ok) {
      return NextResponse.json(badRequest(FAILURE_MESSAGE[result.reason]).toJson(), {
        status: 400,
      });
    }

    return NextResponse.json({ ok: true, amountUsd: result.amountUsd });
  } catch (err) {
    return handleRouteError(err);
  }
}
