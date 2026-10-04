import { ImageResponse } from "next/og";
import { loadPublicRecap } from "@/lib/recap/loadPublicRecap";
import { RecapCardImage, recapImageFonts } from "@/lib/recap/recapImage";

// Uses mongodb → must run on the Node runtime (not edge).
export const runtime = "nodejs";
export const alt = "A House Divided: Season Wrapped";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const [recap, fonts] = await Promise.all([loadPublicRecap(characterId), recapImageFonts()]);
  return new ImageResponse(<RecapCardImage recap={recap} />, { ...size, fonts });
}
