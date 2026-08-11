import { Playfair_Display, DM_Mono } from "next/font/google";

/**
 * Dossier display fonts for the cabinet office, scoped to this route subtree via
 * the `.variable` class names applied on the office layout wrapper.
 *
 * Latin display + mono load through next/font. The CJK serif (Noto Serif SC) is
 * loaded via a Google Fonts <link> only on CN/JP office pages (see layout.tsx)
 * to avoid shipping a large CJK face to every cabinet page — it is referenced
 * through the `--font-dossier-cjk` CSS variable defined in cabinetDossier.css.
 */
export const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-dossier-serif",
  display: "swap",
});

export const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dossier-mono",
  display: "swap",
});

export const cabinetFontVars = `${playfair.variable} ${dmMono.variable}`;
