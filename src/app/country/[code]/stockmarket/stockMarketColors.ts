import type { StockListing } from "./types";

const BRAND_HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

/** Stable display color: use corporate brand hex when valid, else deterministic HSL from id */
export function resolveListingColor(listing: Pick<StockListing, "_id" | "brandColor">): string {
  const c = listing.brandColor?.trim();
  if (c && BRAND_HEX.test(c)) return c;
  return hashIdToHsl(listing._id);
}

function hashIdToHsl(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 62% 50%)`;
}
