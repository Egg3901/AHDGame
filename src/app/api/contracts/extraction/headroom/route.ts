// GET /api/contracts/extraction/headroom?stateId=&resource=&countryId= - Contracted-share headroom.
// Auth: public read. Returns the 75%-cap usage and the licensing authority.
// Errors: 400

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { EXTRACTABLE_RESOURCES, type ExtractableResource } from "@/lib/constants/commodities";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  computeContractedShare,
  computeRemainingContractHeadroom,
} from "@/lib/extraction/computeContractedShare";
import { getResourceContractAuthority } from "@/lib/extraction/contractAuthority";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("stateId");
    const resource = searchParams.get("resource");
    const countryId = searchParams.get("countryId");
    if (!stateId) throw badRequest("stateId is required");
    if (!resource || !EXTRACTABLE_RESOURCES.includes(resource as ExtractableResource)) {
      throw badRequest("Valid resource is required");
    }
    if (!countryId || !(countryId in COUNTRY_CONFIGS)) {
      throw badRequest("Valid countryId is required");
    }

    const db = await getDb();
    const [contractedShare, remainingHeadroom, authority] = await Promise.all([
      computeContractedShare(db, stateId, resource as ExtractableResource),
      computeRemainingContractHeadroom(db, stateId, resource as ExtractableResource),
      getResourceContractAuthority(db, countryId as CountryId),
    ]);

    return NextResponse.json({ contractedShare, remainingHeadroom, authority });
  } catch (error) {
    return handleRouteError(error);
  }
}
