/**
 * Maps semantic ad placement keys to real AdSense slot IDs.
 *
 * AdSense `data-ad-slot` values must be the numeric IDs generated when the
 * ad unit is created in the AdSense console (https://adsense.google.com →
 * Ads → By ad unit). Semantic names are NOT valid slot IDs — a unit with a
 * non-numeric slot never fills and reads as broken ad code to reviewers.
 *
 * Fill in the numeric IDs below after creating each unit in the console.
 * Placements left empty simply do not render (no broken <ins> in the DOM).
 */
const AD_SLOT_IDS: Record<string, string> = {
  "ahd-footer-responsive": "",
  "ahd-about-inarticle": "",
  "ahd-news-infeed": "",
  "ahd-wiki-sidebar": "",
  "ahd-guides-incontent": "",
  "ahd-changelog-native": "",
  "ahd-faq-top": "",
  "ahd-faq-bottom": "",
};

/**
 * Resolves a semantic placement key to its numeric AdSense slot ID.
 * Returns null when the placement is unmapped or the ID is not numeric,
 * so callers can skip rendering entirely instead of emitting invalid code.
 */
export function getAdSlotId(placement: string): string | null {
  const id = AD_SLOT_IDS[placement]?.trim();
  if (!id || !/^\d+$/.test(id)) return null;
  return id;
}
