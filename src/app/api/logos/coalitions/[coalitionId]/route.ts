import { NextRequest } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseCountryParam } from "@/lib/db/partyLookup";
import type { Coalition } from "@/lib/db/types/coalition";
import { redirectToFirstAvailableImage, redirectToFallbackImage } from "@/lib/publicImageProxy";

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

// GET /api/logos/coalitions/[coalitionId] — Redirects to the logo URL for a coalition identified by sequential ID and country.
// Auth: public
// Errors: 400, 404
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ coalitionId: string }> }
) {
  try {
    const { coalitionId } = await params;

    const countryId = parseCountryParam(request.nextUrl.searchParams.get("country"));
    if (!countryId) {
      throw badRequest("A valid ?country= parameter is required (us, uk, ca, de).");
    }

    const sequentialId = parseInt(coalitionId, 10);
    if (isNaN(sequentialId)) {
      throw badRequest("Coalition ID must be a number.");
    }

    const db = await getDb();

    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId, countryId }, { projection: { logoUrl: 1 } });

    if (!coalition || !coalition.logoUrl) {
      return redirectToFallbackImage("/ahd-logo.png", request.url, CACHE_CONTROL);
    }

    const imageResponse = await redirectToFirstAvailableImage(
      [coalition.logoUrl],
      request.url,
      CACHE_CONTROL,
      3600,
      `CoalitionLogo:${coalitionId}`
    );
    if (imageResponse) {
      return imageResponse;
    }

    return redirectToFallbackImage("/ahd-logo.png", request.url, CACHE_CONTROL);
  } catch (error) {
    return handleRouteError(error);
  }
}
