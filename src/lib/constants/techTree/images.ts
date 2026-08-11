/**
 * Tier image URLs for tech-tree nodes. Images are shared per decade-tier (one
 * per lane/sector/decade, not per node) and served from R2. Uploaded by
 * scripts/upload-tech-images-to-r2.mjs; a placeholder is used until art lands.
 */
import type { CorporationType } from "../corporations";
import type { TechLane } from "./nodes";

const CDN_TECH_BASE = "https://cdn.ahousedividedgame.com/static/tech";

/** Placeholder shown until the real image for a tier has been uploaded. */
export const TECH_PLACEHOLDER_IMAGE = `${CDN_TECH_BASE}/placeholder.webp`;

/**
 * CDN URL for a tier's shared image. Corporate-lane art is keyed by decade
 * (reused across all sectors); sector-lane art is keyed by sector + decade.
 */
export function tierImageUrl(
  lane: TechLane,
  sectorType: CorporationType,
  decadeId: string
): string {
  return lane === "generic"
    ? `${CDN_TECH_BASE}/corp/${decadeId}.webp`
    : `${CDN_TECH_BASE}/sector/${sectorType}/${decadeId}.webp`;
}
