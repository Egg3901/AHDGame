import { ImageResponse } from "next/og";
import { loadPublicRecap } from "@/lib/recap/loadPublicRecap";
import { RecapStoryImage, recapImageFonts } from "@/lib/recap/recapImage";

// Uses mongodb → must run on the Node runtime (not edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The 1080x1920 story image behind "Save image" on the Wrapped finale, sized
 * for phone stories. Public like the share page; a frozen recap never changes,
 * so it caches for an hour.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const [recap, fonts] = await Promise.all([loadPublicRecap(characterId), recapImageFonts()]);
  return new ImageResponse(<RecapStoryImage recap={recap} />, {
    width: 1080,
    height: 1920,
    fonts,
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
