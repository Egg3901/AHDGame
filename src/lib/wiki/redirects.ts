/**
 * Wiki redirects: old slug -> new path (relative to /wiki/).
 * Used when slugs change or common shortcuts.
 */
export const WIKI_REDIRECTS: Record<string, string> = {
  democrat: "party/1?country=us",
  democrats: "party/1?country=us",
  republican: "party/2?country=us",
  republicans: "party/2?country=us",
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
  america: "us-overview",
  britain: "uk-overview",
  china: "cn-overview",
  germany: "de-overview",
  ireland: "ie-overview",
  japan: "jp-overview",
  nigeria: "ng-overview",
  "soviet-union": "ru-overview",
  ussr: "ru-overview",
  "east-germany": "dd-overview",
  "independence-referendums": "referendums",
  "campaign-presence": "political-operations",
  monarch: "imperial-characters",
  emperor: "imperial-characters",
};

export function getRedirectTarget(slug: string): string | null {
  const lower = slug.toLowerCase();
  const target = WIKI_REDIRECTS[lower];
  if (!target) return null;
  return target.startsWith("/") ? target : `/wiki/${target}`;
}
