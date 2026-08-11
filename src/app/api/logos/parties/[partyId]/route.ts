import { NextRequest } from "next/server";
import { PARTY_LOGOS } from "@/lib/constants";
import { getDb } from "@/lib/mongodb";
import { findPartyBySequentialId, parseCountryParam } from "@/lib/db/partyLookup";
import type { PoliticalParty } from "@/lib/db/types";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { redirectToFirstAvailableImage, redirectToFallbackImage } from "@/lib/publicImageProxy";

const COUNTRIES: CountryId[] = [...COUNTRY_ORDER];
const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

// GET /api/logos/parties/[partyId] — Returns the party logo image; redirects to custom upload or proxies the default Wikimedia logo.
// Auth: public
// Errors: 404
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ partyId: string }> }
) {
  const { partyId } = await params;

  // First, check if this party has a custom logo in the database
  let customLogoUrl: string | null = null;
  let fallbackLogoUrl: string | null = null;
  let resolvedCountryId: CountryId | null = null;
  let party: PoliticalParty | null = null;
  const countryParam = parseCountryParam(request.nextUrl.searchParams.get("country"));

  try {
    const db = await getDb();

    if (countryParam) {
      // Country specified - direct lookup
      party = await findPartyBySequentialId(db, partyId, countryParam);
      resolvedCountryId = countryParam;
    } else {
      // No country specified - try to find party in any country
      // This provides backwards compatibility for components not yet passing countryId
      // WARNING: This fallback iterates all countries and may return wrong party if IDs collide
      const seqId = parseInt(partyId, 10);
      if (!isNaN(seqId)) {
        for (const country of COUNTRIES) {
          party = await findPartyBySequentialId(db, seqId, country);
          if (party) {
            console.warn(
              `[PartyLogo] Fallback used for partyId=${partyId}, resolved to ${country}. ` +
                `Caller should pass ?country= param to avoid ambiguity.`
            );
            resolvedCountryId = country;
            break;
          }
        }
      }
    }

    if (party?.logoUrl) {
      customLogoUrl = party.logoUrl;
    }
  } catch (err) {
    console.error(`[PartyLogo] DB lookup failed for ${partyId}:`, err);
    // Database lookup failed, fall through to default logos
  }

  // If no custom logo, check for default party logos using countryId:abbreviation format.
  // Abbreviation is preset-stable; keying by sequentialId aliases preset-specific
  // defaults onto each other's logos (e.g. PDS-as-Linke on a fresh 1991 boot).
  const country = countryParam ?? resolvedCountryId;
  const abbreviation = party?.abbreviation ?? null;
  if (country && abbreviation) {
    fallbackLogoUrl = PARTY_LOGOS[`${country}:${abbreviation}`] ?? null;
  }

  if (customLogoUrl) {
    const customImageResponse = await redirectToFirstAvailableImage(
      [customLogoUrl],
      request.url,
      CACHE_CONTROL,
      3600,
      `PartyLogo:${partyId}`
    );
    if (customImageResponse) {
      return customImageResponse;
    }
  }

  if (fallbackLogoUrl) {
    return redirectToFallbackImage(fallbackLogoUrl, request.url, CACHE_CONTROL);
  }

  // Serving the site logo for a party with no custom or default logo is a
  // routine outcome, not an error — any genuine image failure was already
  // logged by the proxy at the point it occurred, so don't log again here.
  return redirectToFallbackImage("/ahd-logo.png", request.url, CACHE_CONTROL);
}
