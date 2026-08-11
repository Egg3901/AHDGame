/**
 * Small color helpers for the national-identity layer.
 *
 * These operate on the per-country *fixed brand colors* in `NATIONAL_IDENTITY`
 * (banner gradient + accent), which are intentionally not theme tokens — so
 * deriving rgba tints / a lighter top-stop from them here is correct and stays
 * isolated to the identity components. All other surfaces use design-system
 * tokens, not these helpers.
 */

/** `#rrggbb` + opacity (0–1) → `rgba(r,g,b,a)`. Falls back to the input if not a hex triplet. */
export function hexToRgba(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** Lighten a `#rrggbb` toward white by fixed channel deltas (for the seal's top gradient stop). */
export function lightenHex(hex: string, dr = 30, dg = 18, db = 18): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = Math.min(255, ((int >> 16) & 255) + dr);
  const g = Math.min(255, ((int >> 8) & 255) + dg);
  const b = Math.min(255, (int & 255) + db);
  return `rgb(${r}, ${g}, ${b})`;
}
