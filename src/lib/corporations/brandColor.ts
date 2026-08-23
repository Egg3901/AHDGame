/**
 * Corporate brand colour: one hue per corporation, and a ramp of shades off it.
 *
 * Two jobs live here so charts and corp creation cannot drift apart:
 *
 *  1. `randomBrandColor()`: every new corp is stamped with a colour at
 *     creation, so a corp is recognisable from the day it exists rather than
 *     falling back to whatever a chart happened to pick.
 *  2. `brandShades()`: breakdown charts of a SINGLE corp (its shareholders,
 *     its cap table) tint every slice off that corp's own colour instead of
 *     running through an unrelated rainbow. The chart then reads as "this
 *     company", and the slices still separate because the ramp moves lightness,
 *     hue and saturation together.
 *
 * Charts that compare DIFFERENT corps (sector market share, state ownership)
 * deliberately do not use the ramp. There each corp wears its own colour.
 */

const BRAND_HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

/**
 * The default palette new corps draw from. Distinct hues, evenly spaced round
 * the wheel, all legible on both the light and dark theme surfaces.
 */
export const CORP_BRAND_PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#ec4899", // pink
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#d946ef", // fuchsia
] as const;

/** A random default brand colour, for a corp founded without one. */
export function randomBrandColor(): string {
  return CORP_BRAND_PALETTE[Math.floor(Math.random() * CORP_BRAND_PALETTE.length)];
}

/** Expand `#abc` to `#aabbcc`; returns null when the input is not a brand hex. */
export function normalizeBrandHex(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw || !BRAND_HEX.test(raw)) return null;
  const body = raw.slice(1);
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toLowerCase();
  }
  return `#${body.toLowerCase()}`;
}

/**
 * The colour to draw a corp in: its own brand hex when it has a valid one,
 * else a stable colour derived from its id so pre-`brandColor` corps still get
 * a consistent identity instead of changing colour between renders.
 */
export function resolveCorpColor(
  brandColor: string | null | undefined,
  fallbackId: string | null | undefined
): string {
  const hex = normalizeBrandHex(brandColor);
  if (hex) return hex;
  return CORP_BRAND_PALETTE[hashToIndex(fallbackId ?? "", CORP_BRAND_PALETTE.length)];
}

function hashToIndex(id: string, buckets: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % buckets;
}

// ─── Shade ramp ───────────────────────────────────────────────────────────────

/** The ramp stays inside this lightness band so no shade turns black or white. */
const LIGHT_MIN = 20;
const LIGHT_MAX = 82;
/** One step of the ramp never exceeds this, so a 2-slice chart is not extreme. */
const MAX_STEP_L = 14;
/** Total hue drift across the ramp. Small enough to stay inside the brand's hue family. */
const MAX_DRIFT_H = 26;
/** Below this saturation the brand reads as grey, and a grey brand gets a grey ramp. */
const ACHROMATIC_S = 12;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/**
 * `count` visually separable shades of `baseHex`, ordered for a chart sorted
 * biggest-slice-first.
 *
 * Index 0 is the brand colour itself. The rest alternate between the two ENDS of
 * the ramp and work inward: lightest, darkest, second lightest, second darkest.
 * Walking the ramp in order would put its two most similar shades side by side,
 * which is exactly where a reader compares them; alternating ends means any two
 * neighbouring slices sit most of the band apart no matter how many there are.
 *
 * Lightness carries the separation, with hue and saturation drifting alongside
 * so long cap tables, where the steps have to get small to fit the band, still
 * separate on two other axes. Past roughly a dozen slices no ramp can stay
 * legible, so callers should aggregate the tail rather than ask for more.
 */
export function brandShades(baseHex: string | null | undefined, count: number): string[] {
  if (count <= 0) return [];
  const raw = hexToHsl(normalizeBrandHex(baseHex) ?? CORP_BRAND_PALETTE[0]);
  // A grey brand has no meaningful hue, so forcing it up to the saturation floor
  // would hand it an arbitrary one and paint the chart red. Keep it grey.
  const achromatic = raw.s < ACHROMATIC_S;
  const base = clampBase(raw, achromatic);
  // Rank 0 is the brand colour; the ramp needs this many steps to each side.
  const maxRank = Math.ceil((count - 1) / 2);
  const stepUp = maxRank === 0 ? 0 : Math.min(MAX_STEP_L, (LIGHT_MAX - base.l) / maxRank);
  const stepDown = maxRank === 0 ? 0 : Math.min(MAX_STEP_L, (base.l - LIGHT_MIN) / maxRank);
  const driftH = maxRank === 0 || achromatic ? 0 : Math.min(9, MAX_DRIFT_H / maxRank);

  return Array.from({ length: count }, (_, i) => {
    const rank = rampRank(i, maxRank);
    const l = base.l + rank * (rank > 0 ? stepUp : stepDown);
    const h = wrapHue(base.h + rank * driftH);
    // Outer shades desaturate slightly: a third axis of separation, and it stops
    // the near-white and near-black ends looking garish.
    const sFloor = achromatic ? 0 : 32;
    const s = clamp(base.s - Math.abs(rank) * 2.5, sFloor, 92);
    return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(clamp(l, LIGHT_MIN, LIGHT_MAX))}%)`;
  });
}

/**
 * Ramp position for output slot `i`: 0, then +max, -max, +(max-1), -(max-1) and
 * so on inward. Every rank in [-max, +max] is used exactly once.
 */
function rampRank(i: number, maxRank: number): number {
  if (i === 0) return 0;
  const stepsIn = Math.ceil(i / 2);
  const magnitude = maxRank - stepsIn + 1;
  return i % 2 === 1 ? magnitude : -magnitude;
}

/**
 * Pull the brand colour towards the middle of the band before ramping. A corp
 * whose brand is nearly white or nearly black has no room on one side, and every
 * shade on that side would collapse onto the same value.
 */
function clampBase(hsl: Hsl, achromatic: boolean): Hsl {
  return {
    h: hsl.h,
    s: achromatic ? clamp(hsl.s, 0, ACHROMATIC_S) : clamp(hsl.s, 40, 88),
    l: clamp(hsl.l, 42, 58),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: wrapHue(h * 60), s: s * 100, l: l * 100 };
}
