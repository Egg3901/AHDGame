import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { loadOrganizationDef, isMember } from "@/lib/internationalOrganizations/service";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import { proposeInternationalOrganizationLeave } from "@/lib/internationalOrganizations/commands/proposeLeave";

const proposeLeaveSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("organization"),
    confirmElectionRisk: z.boolean().optional(),
  }),
  z.object({
    targetType: z.literal("free_trade_agreement"),
    legislationId: schemas.objectId,
    confirmElectionRisk: z.boolean().optional(),
  }),
]);

// POST /api/country/[code]/international-organizations/[orgId]/propose-leave - Foreign-affairs executive proposes a legislature-ratified withdrawal.
// Auth: requireAuthWithCharacter + requireForeignMinister
// Errors: 400, 401, 403, 404, 409, 429
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

    const parsed = await parseJsonBody(request, proposeLeaveSchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), { status: parsed.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`org-leave:${auth.user.userId}`, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json(badRequest("No character found").toJson(), { status: 400 });
    }

    const organizationDef = await loadOrganizationDef(db, orgId);
    if (!organizationDef) {
      return NextResponse.json(badRequest("Unknown organization").toJson(), { status: 404 });
    }

    const foreignMinister = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!foreignMinister.ok) return foreignMinister.response;

    const freezeCheck = await checkLegislationFreeze(countryId);
    if (!freezeCheck.ok) return freezeCheck.response;

    if (!(await isMember(db, orgId, countryId))) {
      return NextResponse.json(
        badRequest(
          `${COUNTRY_CONFIGS[countryId].name} is not a member of ${organizationDef.name}.`
        ).toJson(),
        { status: 400 }
      );
    }

    const result = await proposeInternationalOrganizationLeave({
      db,
      countryId,
      orgId,
      organizationName: organizationDef.name,
      actor: {
        characterId: foreignMinister.auth.characterId,
        characterName: foreignMinister.auth.characterName,
        party: auth.user.character.party ?? undefined,
        actions: character.actions ?? 0,
      },
      input: parsed.data,
    });

    if (!result.ok) {
      const responseBody: Record<string, unknown> = { error: result.error };
      if ("autoFailWarning" in result && result.autoFailWarning) {
        responseBody.autoFailWarning = result.autoFailWarning;
        responseBody.requiresElectionRiskConfirmation = true;
      }
      return NextResponse.json(responseBody, { status: result.status });
    }

    return NextResponse.json({ ok: true, billId: result.billId }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
