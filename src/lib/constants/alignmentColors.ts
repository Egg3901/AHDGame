/**
 * Bloc colors. A player's chosen color identifies the same Bloc in its dossier,
 * influence, alignment bars and map. Legacy semantic color choices stay valid.
 */
import {
  isCustomAlignmentPoleToken,
  type AlignmentPoleToken,
  type CustomAlignmentPoleToken,
} from "./alignmentEras";

// Organization identities and map/canvas palettes need literal colors. Keep
// user-selected identity colors here instead of hardcoding them in components.
const LEGACY_PALETTES = {
  info: { accent: "#4f86d9", accentSoft: "#a9c7f2" },
  error: { accent: "#c34d58", accentSoft: "#e7a5ab" },
  warning: { accent: "#c58b20", accentSoft: "#efd08a" },
};

export function customBlocPalette(color: CustomAlignmentPoleToken): {
  accent: string;
  accentSoft: string;
} {
  if (!isCustomAlignmentPoleToken(color)) return LEGACY_PALETTES.info;
  if (!color.startsWith("#")) return LEGACY_PALETTES[color as keyof typeof LEGACY_PALETTES];
  const accent = color.toLowerCase();
  const accentSoft =
    "#" +
    [1, 3, 5]
      .map((offset) => {
        const channel = parseInt(accent.slice(offset, offset + 2), 16);
        return Math.round(channel + (255 - channel) * 0.55)
          .toString(16)
          .padStart(2, "0");
      })
      .join("");
  return { accent, accentSoft };
}

/** Validated custom colors are literal identity data, not arbitrary CSS. */
export function alignmentColor(color: AlignmentPoleToken): string {
  if (color.startsWith("#")) return customBlocPalette(color as CustomAlignmentPoleToken).accent;
  return `var(--${color})`;
}
