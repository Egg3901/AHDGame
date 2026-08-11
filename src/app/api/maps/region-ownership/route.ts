import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getRegionDetails } from "@/lib/maps/regionOwnership";
import { allRegionCodes } from "@/lib/maps/regionManifest";
import type { CountryId } from "@/lib/constants/countries";

// GET /api/maps/region-ownership
// Public read for every region code in the manifest (all shards — British Isles,
// Germany, Brazil, China, Japan — via allRegionCodes()):
//   { ownership: { regionCode: countryId },
//     regions:   { regionCode: { countryId, name, population, houseDistricts, region } } }
// `ownership` drives which owner each region renders under (world/UK maps, and the
// Germany overlay — DE in unified eras, DE+DD in 1979); `regions` carries the live,
// preset-correct figures the IE map displays. Adding a shard to the manifest
// extends this automatically — no edit here.
export async function GET() {
  try {
    const db = await getDb();
    const regions = await getRegionDetails(db, allRegionCodes());
    const ownership: Record<string, CountryId> = {};
    for (const [code, detail] of Object.entries(regions)) {
      ownership[code] = detail.countryId;
    }
    return NextResponse.json({ ownership, regions });
  } catch (error) {
    return handleRouteError(error);
  }
}
