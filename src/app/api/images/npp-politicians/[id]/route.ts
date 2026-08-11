/**
 * NPP politician portrait image route.
 * Redirects to the Wikipedia thumbnail URL for the requested politician ID.
 *
 * Auth:    Public (no auth required — used as an <img src>)
 * Cache:   7 days (politician portrait URLs are stable)
 * Errors:  404 if ID not in the image data file
 */

import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";

interface PoliticianImage {
  id: string;
  url: string;
}

// Module-level cache so we only read the file once per server lifecycle
let imageMapCache: Map<string, string> | null = null;

function getImageMap(): Map<string, string> {
  if (imageMapCache) return imageMapCache;

  const filePath = path.join(process.cwd(), "src", "data", "npp-politician-images.json");
  if (!fs.existsSync(filePath)) {
    imageMapCache = new Map();
    return imageMapCache;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PoliticianImage[];
    imageMapCache = new Map(data.filter((p) => p.url).map((p) => [p.id, p.url]));
  } catch {
    imageMapCache = new Map();
  }

  return imageMapCache;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = getImageMap().get(id);

  if (!url) {
    return new NextResponse("Not Found", { status: 404 });
  }

  return NextResponse.redirect(url, {
    status: 307,
    headers: {
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400, no-transform",
    },
  });
}
