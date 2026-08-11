import { NextRequest, NextResponse } from "next/server";
import { CDN_ACTION_IMAGE_URLS } from "@/lib/images/staticCdnAssets";

const ACTION_IMAGE_URLS: Record<string, string> = {
  campaign: CDN_ACTION_IMAGE_URLS.campaign,
  advertise: CDN_ACTION_IMAGE_URLS.advertise,
  fundraise: CDN_ACTION_IMAGE_URLS.fundraise,
  flipflop: CDN_ACTION_IMAGE_URLS.flipflop,
  debatePrep: CDN_ACTION_IMAGE_URLS.debatePrep,
  canvass: CDN_ACTION_IMAGE_URLS.canvass,
  convertCash: CDN_ACTION_IMAGE_URLS.convertCash,
};

// GET /api/images/actions/[slug] — Redirects to the R2 CDN action card image.
// Kept for backwards compatibility; new code should use CDN_ACTION_IMAGE_URLS directly.
// Auth: public
// Errors: 404
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = ACTION_IMAGE_URLS[slug];
  if (!url) {
    return new NextResponse("Not Found", { status: 404 });
  }

  return NextResponse.redirect(url, {
    status: 307,
    headers: {
      "Cache-Control": "public, max-age=86400, no-transform",
    },
  });
}
