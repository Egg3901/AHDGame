import type { ReactNode } from "react";
import "./_coldwar/theme.css";

/**
 * Wraps every Cold War section route in the themed-island shell: the `.cw-root`
 * scope (dark palette + scrollbars + `cw*` keyframes) and the bespoke fonts
 * (Lora + IBM Plex Mono) the design references by literal family name. Loaded
 * via the same Google Fonts stylesheet the mockups use so the verbatim-ported
 * inline `font-family:Lora` / `'IBM Plex Mono'` references resolve.
 */
export default function ConflictsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {/* Intentionally scoped to this section (the themed island) rather than the
          app-wide next/font pipeline — the design references these families by
          literal name in inline styles, and loading them only here is desired. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,500;0,600;0,700;1,500&family=IBM+Plex+Mono:wght@400;500;600;700&family=Permanent+Marker&display=swap"
      />
      <div className="cw-root">{children}</div>
    </>
  );
}
