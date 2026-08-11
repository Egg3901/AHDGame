/**
 * Wiki redirects: old slug -> new path (relative to /wiki/).
 * Used when slugs change or common shortcuts.
 */
export const WIKI_REDIRECTS: Record<string, string> = {
  democrat: "party/democrat",
  republican: "party/republican",
  "election-history": "elections",
};

export function getRedirectTarget(slug: string): string | null {
  const lower = slug.toLowerCase();
  const target = WIKI_REDIRECTS[lower];
  if (!target) return null;
  return target.startsWith("/") ? target : `/wiki/${target}`;
}
