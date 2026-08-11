// POST /api/country/[code]/international-organizations/[orgId]/fund
// Foreign minister of `code` (a current member) raises a domestic bill to send
// treasury money to the organization's pooled fund. On the bill's passage the
// amount is debited from the treasury and credited (FX → USD) to the org fund.
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
import { buildMembershipBill } from "@/lib/internationalOrganizations/commands/buildMembershipBill";

const fundSchema = z.object({
  amountLocal: z.number().positive().max(1e15),
});

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

    const body = await parseJsonBody(request, fundSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rl = checkRateLimit(`org-fund:${ip}`, 10, 60_000);
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

    if (!(await isMember(db, orgId, countryId))) {
      return NextResponse.json(badRequest(`${countryId} is not a member of ${orgId}.`).toJson(), {
        status: 400,
      });
    }

    const countryName = COUNTRY_CONFIGS[countryId].name;
    const organizationName = orgDef.name ?? orgId;
    const amountLocal = Math.round(body.data.amountLocal);
    const billId = await buildMembershipBill({
      db,
      countryId,
      sponsor: {
        characterId: fm.auth.characterId,
        characterName: fm.auth.characterName,
        party: auth.user.character.party,
      },
      title: `Appropriation to Fund ${organizationName}`,
      summary: `${countryName} would send ${amountLocal.toLocaleString()} (local) from the treasury to ${organizationName}'s fund.`,
      fullText: `Upon enactment, ${countryName} shall transfer ${amountLocal.toLocaleString()} (local currency) from the national treasury to the ${organizationName} pooled fund (converted to the fund's currency at no charge).`,
      provisions: [
        {
          type: "international_organization",
          subType: "fund",
          organizationId: orgId,
          organizationName,
          amountLocal,
        },
      ],
    });

    return NextResponse.json({ ok: true, billId: billId.toString() });
  } catch (err) {
    return handleRouteError(err);
  }
}
