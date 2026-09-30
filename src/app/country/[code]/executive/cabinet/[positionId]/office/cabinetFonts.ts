import localFont from "next/font/local";

/**
 * Dossier display fonts for the cabinet office, scoped to this route subtree via
 * the `.variable` class names applied on the office layout wrapper.
 *
 * Latin display + mono are self-hosted so production builds do not depend on
 * Google Fonts being reachable. The CJK serif (Noto Serif SC) is loaded via a
 * Google Fonts <link> only on CN/JP office pages (see layout.tsx) to avoid
 * shipping a large CJK face to every cabinet page. It is referenced through
 * the `--font-dossier-cjk` CSS variable defined in cabinetDossier.css.
 */
export const playfair = localFont({
  src: "./fonts/PlayfairDisplay-Variable.ttf",
  weight: "400 900",
  style: "normal",
  variable: "--font-dossier-serif",
  display: "swap",
});

export const dmMono = localFont({
  src: [
    {
      path: "./fonts/DMMono-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/DMMono-Medium.ttf",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-dossier-mono",
  display: "swap",
});

export const cabinetFontVars = `${playfair.variable} ${dmMono.variable}`;
