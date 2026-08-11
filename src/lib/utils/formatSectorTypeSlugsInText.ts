import { CORPORATION_TYPES, CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { escapeRegex } from "./escapeRegex";

/**
 * Replace corporation sector type slugs (e.g. `real_estate`) with display labels
 * for wire/news tickers. Token boundaries avoid matching inside other identifiers.
 */
export function formatSectorTypeSlugsInText(text: string): string {
  if (!text) return text;
  const slugs = [...CORPORATION_TYPES].sort((a, b) => b.length - a.length);
  let out = text;
  for (const slug of slugs) {
    const label = CORPORATION_TYPE_LABELS[slug];
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(slug)}(?![A-Za-z0-9_])`, "g");
    out = out.replace(re, label);
  }
  return out;
}
