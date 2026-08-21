/**
 * Wiki redirects: old slug -> new path (relative to /wiki/).
 * Used when slugs change or common shortcuts.
 */
export const WIKI_REDIRECTS: Record<string, string> = {
  democrat: "party/democrat",
  republican: "party/republican",
  "election-history": "elections",
  "crisis-system": "crisis-interaction",
  "formula-deep-dive": "reference-formulas",
  "meta-strategy": "advanced-strategy",
  "min-maxing": "power-player-guide",
  "npp-opponents": "npp-elections",
  "npp-system": "npps-overview",
  parties: "political-parties",
  "party-building": "party-organization",
  "state-level-power": "reference-offices",
  "united-kingdom": "uk-overview",
};

export function getRedirectTarget(slug: string): string | null {
  const lower = slug.toLowerCase();
  const target = WIKI_REDIRECTS[lower];
  if (!target) return null;
  return target.startsWith("/") ? target : `/wiki/${target}`;
}
