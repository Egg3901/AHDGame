import type { ChangelogBadge, ChangelogPost, DevArea } from "./types";

/** Compare semver strings (newest first). */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function groupPostsByMonth(
  posts: ChangelogPost[]
): { month: string; posts: ChangelogPost[] }[] {
  const map = new Map<string, ChangelogPost[]>();
  for (const post of posts) {
    const key = monthKey(post.date);
    const group = map.get(key) ?? [];
    group.push(post);
    map.set(key, group);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, monthPosts]) => ({ month, posts: monthPosts }));
}

export function postMatchesFilters(
  post: ChangelogPost,
  opts: { search?: string; tag?: string; badge?: string; era?: string; area?: string }
): boolean {
  const q = opts.search?.trim().toLowerCase();
  if (q) {
    const haystack = [post.title, post.summary, post.body, post.version, ...post.tags]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (opts.tag && opts.tag !== "all" && !post.tags.includes(opts.tag)) return false;
  if (opts.badge && opts.badge !== "all" && !post.badges.includes(opts.badge as ChangelogBadge))
    return false;
  if (opts.era && opts.era !== "all" && post.era !== opts.era) return false;
  if (opts.area && opts.area !== "all") {
    const areas = post.areas ?? [];
    if (opts.area === "fullstack") {
      if (
        !areas.includes("fullstack") &&
        !(areas.includes("backend") && areas.includes("frontend"))
      )
        return false;
    } else if (!areas.includes(opts.area as DevArea)) {
      return false;
    }
  }
  return true;
}

export function collectUniqueTags(posts: ChangelogPost[]): string[] {
  return [...new Set(posts.flatMap((p) => p.tags))].sort();
}

export function collectUniqueEras(posts: ChangelogPost[]): string[] {
  return [...new Set(posts.map((p) => p.era).filter(Boolean) as string[])].sort();
}

/**
 * Rough reading time for a post body, in minutes (floor 1).
 *
 * Counts words only: fenced chart specs and image markup are stripped first, so
 * a post carrying three charts is not reported as a 12-minute read on the
 * strength of its JSON.
 */
export function estimateReadingMinutes(body: string): number {
  const prose = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[#*_>`|-]/g, " ");
  const words = prose.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * The prose of a post body, with chart specs, image markup and markdown syntax
 * removed.
 *
 * The public feed ships every post to the client so it can search across
 * releases, but it never renders a body — that moved to /changelog/[slug].
 * Sending the raw markdown means shipping every chart's JSON and every image
 * path for a page that shows none of it, and the cost grows with each release.
 * Sending the prose keeps search working (and stops a query for "chart" from
 * matching a chart's own spec) at a fraction of the bytes.
 */
export function searchableProse(body: string): string {
  return (
    body
      // A chart's own title and caption are prose the reader sees, so keep them
      // searchable; everything else in the spec is machinery.
      .replace(/```chart\n([\s\S]*?)```/g, (_m, spec: string) => {
        const kept: string[] = [];
        for (const m of spec.matchAll(/"(?:title|caption)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
          kept.push(m[1].replace(/\\"/g, '"'));
        }
        return ` ${kept.join(" ")} `;
      })
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#*_>`|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}
