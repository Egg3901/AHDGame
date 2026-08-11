import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { type CountryId } from "@/lib/constants/countries";
import { getRepresentativeCentralBankCountry } from "@/lib/centralBank/helpers";

export interface IntorgRouteContext {
  params: Promise<{ orgId: string }>;
}

export async function resolveIntorgCentralBankCountry(
  context: IntorgRouteContext
): Promise<{ countryId: CountryId } | { response: NextResponse }> {
  const { orgId } = await context.params;
  const upperOrgId = orgId.toUpperCase();
  const org = INTERNATIONAL_ORGANIZATIONS[upperOrgId as keyof typeof INTERNATIONAL_ORGANIZATIONS];
  if (!org) {
    return {
      response: NextResponse.json(notFound("Organization not found").toJson(), { status: 404 }),
    };
  }

  const countryId = getRepresentativeCentralBankCountry(upperOrgId);
  if (!countryId) {
    return {
      response: NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 }),
    };
  }

  return { countryId };
}

export function countryCentralBankContext(countryId: CountryId) {
  return { params: Promise.resolve({ code: countryId.toLowerCase() }) };
}
