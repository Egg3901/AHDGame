import { OPERATING_SECTOR_TYPES, OPERATING_SECTOR_TYPE_LABELS } from "@/lib/constants/corporations";
import { escapeRegex } from "./escapeRegex";

/**
 * Replace operating-lane slugs (e.g. `real_estate`, `manufacturing_vehicles`) with display labels
 * for wire/news tickers. Token boundaries avoid matching inside other identifiers.
 */
export function formatSectorTypeSlugsInText(text: string): string {
  if (!text) return text;
  const slugs = [...OPERATING_SECTOR_TYPES].sort((a, b) => b.length - a.length);
  let out = text;
  for (const slug of slugs) {
    const label = OPERATING_SECTOR_TYPE_LABELS[slug];
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(slug)}(?![A-Za-z0-9_])`, "g");
    out = out.replace(re, label);
  }
  return out;
}
