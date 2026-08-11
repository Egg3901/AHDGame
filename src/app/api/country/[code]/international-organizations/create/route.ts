// POST /api/country/[code]/international-organizations/create
// Foreign minister of `code` founds a new player-created international
// organization. The creator's country becomes the sole founding member; other
// countries join later via the standard membership-proposal flow.
import { z } from "zod";
import {
  CREATABLE_ORGANIZATION_CATEGORIES,
  type OrganizationCategory,
} from "@/lib/constants/orgCategory";
import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { createInternationalOrganization } from "@/lib/internationalOrganizations/commands/createOrganization";

const createSchema = z.object({
  id: z.string().min(2).max(32),
  name: z.string().min(3).max(80),
  shortName: z.string().min(1).max(5),
  description: z.string().min(1).max(500),
  charter: z.string().min(1).max(2000),
  leadershipTitle: z.string().min(1).max(60),
  // Derived, not repeated: "bloc" is absent because it is a designation the world
  // confers on the two alliances that WERE the Cold War, and a hand-copied list
  // here would silently reject any category added to the constant later.
  category: z.enum(
    CREATABLE_ORGANIZATION_CATEGORIES as [OrganizationCategory, ...OrganizationCategory[]]
  ),
  logoPath: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }

    const body = await parseJsonBody(request, createSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rateLimit = checkRateLimit(`org-create:${ip}`, 5, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const foreignMinister = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!foreignMinister.ok) return foreignMinister.response;

    const result = await createInternationalOrganization({
      db,
      countryId,
      actor: {
        characterId: foreignMinister.auth.characterId,
        characterName: foreignMinister.auth.characterName,
      },
      input: body.data,
    });
    if (!result.ok) {
      return NextResponse.json(badRequest(result.error).toJson(), { status: result.status });
    }

    return NextResponse.json({ ok: true, organizationId: result.organizationId });
  } catch (err) {
    return handleRouteError(err);
  }
}
