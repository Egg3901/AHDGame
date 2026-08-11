import { NextRequest, NextResponse } from "next/server";
import { STATE_FLAGS } from "@/lib/constants/flags";

// GET /api/flags/[stateId] — Proxies state/regional flag images from Wikimedia.
// Proxying instead of redirecting avoids browser hotlink blocks and lets us
// set cache headers so Wikimedia is only hit once per flag per day.
// Auth: public
// Errors: 404 (unknown state), 502 (upstream fetch failed)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ stateId: string }> }
) {
  const { stateId } = await params;
  const id = stateId.toUpperCase();

  const wikimediaUrl = STATE_FLAGS[id];
  if (!wikimediaUrl) {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const response = await fetch(wikimediaUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AHouseDivided/1.0; +https://ahousedividedgame.com)",
        Referer: "https://en.wikipedia.org/",
      },
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      return new NextResponse("Image fetch failed", { status: 502 });
    }

    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("Content-Type") ?? "image/png";

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, no-transform",
      },
    });
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
