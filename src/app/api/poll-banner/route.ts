import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getCachedPollBanner } from "@/lib/pollBannerCache";

// GET /api/poll-banner - Public state of the site-wide poll/survey banner.
// Auth: public
// Errors: (none)
/**
 * GET — what the banner under the navbar should render right now.
 *
 * Public on purpose: the banner shows to signed-out visitors too, so this
 * cannot sit behind auth. `getCachedPollBanner` collapses a disabled banner to
 * empty strings, so a link an admin is still drafting is never served here.
 */
export async function GET() {
  try {
    const snapshot = await getCachedPollBanner();
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, max-age=10, s-maxage=10, stale-while-revalidate=10, no-transform",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
