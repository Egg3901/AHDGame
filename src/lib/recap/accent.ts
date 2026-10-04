/**
 * The Wrapped palette is black, white and one data color: the player's party
 * color marks "you" in every chart. Party colors are authored for light UI
 * chips, so a navy or oxblood would vanish on the story's black ground. This
 * lifts lightness in HSL until the color clears a contrast floor against black,
 * keeping the hue the player recognizes.
 */

const FALLBACK_ACCENT = "#6EA8FE";
/** Minimum WCAG contrast against #000 for a chart mark or headline accent. */
const MIN_CONTRAST_ON_BLACK = 6;

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/** Contrast ratio of a color against pure black. */
export function contrastOnBlack(hex: string): number {
  const rgb = parseHex(hex);
  return rgb ? (luminance(rgb) + 0.05) / 0.05 : 1;
}

/**
 * The player's party color, lifted until it reads on black. Grays and
 * near-white colors pass through; unparseable input falls back to a neutral
 * blue so a missing party color never renders invisible marks.
 */
export function recapAccent(partyColor: string | null | undefined): string {
  const rgb = partyColor ? parseHex(partyColor) : null;
  if (!rgb) return FALLBACK_ACCENT;
  if ((luminance(rgb) + 0.05) / 0.05 >= MIN_CONTRAST_ON_BLACK) return toHex(rgb);
  const [h, s, l] = rgbToHsl(rgb);
  for (let next = l; next <= 0.95; next += 0.02) {
    const candidate = hslToRgb([h, Math.min(s, 0.85), next]);
    if ((luminance(candidate) + 0.05) / 0.05 >= MIN_CONTRAST_ON_BLACK) return toHex(candidate);
  }
  return "#E6E6E6";
}
