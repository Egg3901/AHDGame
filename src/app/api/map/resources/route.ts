// GET ?countryId=US&resource=oil
// Returns per-state capacity, contracted%, open-access% for the map choropleth

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { ZOD_COUNTRY_ENUM, type CountryId } from "@/lib/constants/countries";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { activeExtractionContractFilter } from "@/lib/db/collections/extractionContracts";

const countryIdSchema = z.enum(ZOD_COUNTRY_ENUM);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const countryIdRaw = searchParams.get("countryId");
    const resource = searchParams.get("resource") as ExtractableResource | null;

    if (!countryIdRaw) throw badRequest("countryId required");
    const countryIdParsed = countryIdSchema.safeParse(countryIdRaw);
    if (!countryIdParsed.success) throw badRequest("Invalid countryId");
    const countryId: CountryId = countryIdParsed.data;

    if (!resource || !EXTRACTABLE_RESOURCES.includes(resource)) {
      throw badRequest("Valid resource required");
    }

    const db = await getDb();

    const [capacityDocs, contracts] = await Promise.all([
      db.collection<StateResourceCapacity>("stateResourceCapacity").find({ countryId }).toArray(),
      db
        .collection<ExtractionContract>("extractionContracts")
        .find({ countryId, resource, ...activeExtractionContractFilter() })
        .toArray(),
    ]);

    const contractedByState = new Map<string, number>();
    for (const c of contracts) {
      contractedByState.set(c.stateId, (contractedByState.get(c.stateId) ?? 0) + c.share);
    }

    const result: Record<
      string,
      { capacity: number; contractedPct: number; openAccessPct: number }
    > = {};
    for (const doc of capacityDocs) {
      const capacity = doc.resources[resource] ?? 0;
      const contractedPct = Math.min(1, contractedByState.get(doc.stateId) ?? 0);
      result[doc.stateId] = {
        capacity,
        contractedPct,
        openAccessPct: Math.max(0, 1 - contractedPct),
      };
    }

    return NextResponse.json({ resource, countryId, states: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
