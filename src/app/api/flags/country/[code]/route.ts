import { NextRequest, NextResponse } from "next/server";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getCountryFlagUrlForEra, resolveCountryFlagCode } from "@/lib/constants/flags";

/** ISO 3166-1 alpha-2 codes we support (flagcdn uses lowercase). */
const CONFIG_CODES = new Set(
  Object.values(COUNTRY_CONFIGS).map((c) => resolveCountryFlagCode(c.code))
);
// Countries not yet in COUNTRY_CONFIGS but needed for flag display
const EXTRA_CODES = ["RU", "CN", "AU", "EU"];
const SUPPORTED_CODES = new Set([...CONFIG_CODES, ...EXTRA_CODES]);

// GET /api/flags/country/[code] — Redirects to the Flagcdn country flag image by ISO 3166-1 alpha-2 code.
// Using a redirect instead of proxying eliminates function execution time and prevents timeouts.
// Auth: public
// Errors: 404
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryCode = resolveCountryFlagCode(code);

  if (!SUPPORTED_CODES.has(countryCode)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Era-aware flag: callers pass the active preset (?era=) so the Russia/USSR
  // entity flies the Soviet flag in 1979 and the Russian tricolor otherwise.
  // The preset is in the URL, so the 1-day cache stays correct per era.
  const era = request.nextUrl.searchParams.get("era") ?? undefined;

  return NextResponse.redirect(getCountryFlagUrlForEra(countryCode, era), {
    status: 307,
    headers: {
      "Cache-Control": "public, max-age=86400, no-transform",
    },
  });
}
