/**
 * SCOTUS art set, served from our own Cloudflare R2 CDN
 * (`cdn.ahousedividedgame.com/static/scotus/...`). The sources are
 * public-domain works (U.S. government / U.S. Courts / Library of Congress)
 * that were mirrored off Wikimedia Commons via
 * `scripts/upload-scotus-images-to-r2.mjs` (re-runnable), so the page does not
 * hotlink a third-party host. Portraits are 480px square webp; the hero is a
 * wide webp.
 *
 * Only the most recognizable historical justices are mapped; everyone else
 * (players, generated NPP justices, unmapped historical occupants) falls back
 * to DEFAULT_JUSTICE_AVATAR, an inline SVG with zero network dependency so a
 * seat card always renders a dignified placeholder even offline.
 */

const SCOTUS_CDN_BASE = "https://cdn.ahousedividedgame.com/static/scotus";

/** Hero banner: the U.S. Supreme Court building. */
export const SCOTUS_HERO_IMAGE_URL = `${SCOTUS_CDN_BASE}/building.webp`;

/**
 * Inline SVG data URI: a neutral, institutional column-and-pediment motif in
 * currentColor. Used for any seat without a mapped portrait. Kept inline so it
 * never depends on the network or an external host.
 */
export const DEFAULT_JUSTICE_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M8 22 32 10l24 12" />` +
      `<path d="M12 22v24M24 22v24M40 22v24M52 22v24" />` +
      `<path d="M8 46h48M6 52h52" />` +
      `</svg>`
  );

/** Mirrored public-domain portraits keyed by the justice's exact seed name. */
export const HISTORICAL_JUSTICE_IMAGE_URLS: Readonly<Record<string, string>> = {
  "Earl Warren": `${SCOTUS_CDN_BASE}/earl-warren.webp`,
  "Hugo L. Black": `${SCOTUS_CDN_BASE}/hugo-black.webp`,
  "William O. Douglas": `${SCOTUS_CDN_BASE}/william-o-douglas.webp`,
  "William H. Rehnquist": `${SCOTUS_CDN_BASE}/william-rehnquist.webp`,
  "Ruth Bader Ginsburg": `${SCOTUS_CDN_BASE}/ruth-bader-ginsburg.webp`,
  "Stanley F. Reed": `${SCOTUS_CDN_BASE}/stanley-reed.webp`,
  "Tom C. Clark": `${SCOTUS_CDN_BASE}/tom-clark.webp`,
};

/**
 * Portrait URL for a justice by name, or null when there is no mapped portrait
 * (caller should render DEFAULT_JUSTICE_AVATAR in that case). Returning null
 * rather than the default lets the seat card decide styling per case.
 */
export function getJusticePortrait(justiceName: string | null): string | null {
  if (!justiceName) return null;
  return HISTORICAL_JUSTICE_IMAGE_URLS[justiceName] ?? null;
}
