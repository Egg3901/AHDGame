/**
 * Bundled Geist @font-face rules for server-rendered chart/card SVGs.
 * Each SVG document must embed the font itself — an SVG pulled in via <image>
 * does not inherit the parent's @font-face.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let fontCssCache: string | undefined;

export function bundledChartFontCss(): string {
  if (fontCssCache !== undefined) return fontCssCache;
  try {
    const regular = readFileSync(join(process.cwd(), "public/fonts/Geist-Regular.ttf")).toString(
      "base64"
    );
    const semibold = readFileSync(join(process.cwd(), "public/fonts/Geist-SemiBold.ttf")).toString(
      "base64"
    );
    fontCssCache = `@font-face{font-family:AHDGeist;src:url(data:font/ttf;base64,${regular});font-weight:400}@font-face{font-family:AHDGeist;src:url(data:font/ttf;base64,${semibold});font-weight:600 900}`;
  } catch {
    fontCssCache = "";
  }
  return fontCssCache;
}
