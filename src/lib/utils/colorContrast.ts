/**
 * Returns an accessible text color (#ffffff or #0f172a) for a given hex background color.
 * Uses the W3C relative luminance formula — above the equal-contrast threshold, dark text is used.
 */
export function contrastTextColor(hex: string): string {
  const clean = hex.replace("#", "");
  // Expand 3-digit shorthand (e.g. "fff" -> "ffffff") before parsing.
  const expanded = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (expanded.length !== 6) return "#ffffff";

  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;

  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  // Above the equal-contrast luminance threshold (~0.179), dark text gives better contrast.
  return L > 0.179 ? "#0f172a" : "#ffffff";
}
