import type { ChangelogBadge } from "./types";

/**
 * Turning a pile of per-change notes into one release post.
 *
 * The alternative, and what the repository actually did for six weeks, is to
 * publish every note as its own version. That reached 1.4.63 with 193 entries
 * inside one minor line, and no reader could tell which of them were the
 * release and which were the follow-up fixes to it.
 */

export interface ReleaseNote {
  /** Filename stem of the unreleased note, used only in error messages. */
  topic: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
  badges: ChangelogBadge[];
  areas: string[];
}

/**
 * Sections of a release post, in the order they are printed, with the tags that
 * route a note into each. First match wins.
 *
 * Grouping by badge alone gives two headings, which for a release carrying a
 * hundred changes is a wall. These are the arcs a release actually has, and a
 * note lands in one by the tags its author already wrote.
 */
export const RELEASE_SECTIONS: { name: string; tags: string[] }[] = [
  {
    name: "Elections and campaigns",
    tags: [
      "elections",
      "campaigns",
      "presidential",
      "primaries",
      "parties",
      "politics",
      "electorate",
      "polling",
      "voting",
      "redistricting",
      "approval",
    ],
  },
  {
    name: "Government and legislation",
    tags: [
      "legislation",
      "cabinet",
      "executive",
      "legislature",
      "governance",
      "budget",
      "treasury",
      "impeachment",
      "courts",
      "law",
      "policy",
    ],
  },
  {
    name: "War and diplomacy",
    tags: [
      "military",
      "conflicts",
      "war",
      "diplomacy",
      "reunification",
      "nuclear",
      "coldwar",
      "intelligence",
      "intorg",
      "blocs",
      "crises",
      "crisis",
      "casualties",
    ],
  },
  {
    name: "Economy and corporations",
    tags: [
      "economy",
      "corporations",
      "banking",
      "bonds",
      "funds",
      "market",
      "markets",
      "trade",
      "logistics",
      "central-bank",
      "unions",
      "labour",
      "extraction",
      "energy",
      "plants",
      "freight",
      "investing",
    ],
  },
  {
    name: "Interface and platform",
    tags: [
      "ui",
      "ui-ux",
      "wiki",
      "api",
      "observability",
      "performance",
      "notifications",
      "ask",
      "singleplayer",
      "launcher",
      "client",
      "admin",
      "supporter",
      "iterations",
      "maps",
      "quality",
    ],
  },
];

export const OTHER_SECTION = "Other changes";

export function sectionForNote(note: Pick<ReleaseNote, "tags">): string {
  const tags = note.tags.map((t) => t.toLowerCase());
  for (const section of RELEASE_SECTIONS) {
    if (tags.some((t) => section.tags.includes(t))) return section.name;
  }
  return OTHER_SECTION;
}

const BADGE_RANK: Record<string, number> = { major: 0, minor: 1, patch: 2, hotfix: 3 };

/** Biggest change first inside a section, then oldest, then alphabetical. */
export function compareNotes(a: ReleaseNote, b: ReleaseNote): number {
  const rank = (n: ReleaseNote) =>
    Math.min(...(n.badges.length > 0 ? n.badges : ["patch"]).map((x) => BADGE_RANK[x] ?? 2));
  return rank(a) - rank(b) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
}

/** The union of every note's badges, reduced to the largest one. */
export function releaseBadge(notes: ReleaseNote[]): ChangelogBadge {
  const ranks = notes.flatMap((n) => (n.badges.length > 0 ? n.badges : ["patch"]));
  const best = ranks.reduce(
    (acc, b) => ((BADGE_RANK[b] ?? 2) < (BADGE_RANK[acc] ?? 2) ? b : acc),
    "patch" as string
  );
  return best as ChangelogBadge;
}

/**
 * Tags for the release post: the ones that recur, capped.
 *
 * The union of a hundred notes' tags is forty filter chips, which is the same
 * as no filter at all.
 */
export function releaseTags(notes: ReleaseNote[], limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

export function releaseAreas(notes: ReleaseNote[]): string[] {
  return [...new Set(notes.flatMap((n) => n.areas))].sort();
}

/** The body of a release post: a lede, then every note grouped and listed. */
export function foldNotes(notes: ReleaseNote[], lede: string): string {
  const ordered = [...notes].sort(compareNotes);
  const sections = new Map<string, ReleaseNote[]>();
  for (const name of [...RELEASE_SECTIONS.map((s) => s.name), OTHER_SECTION]) {
    sections.set(name, []);
  }
  for (const note of ordered) sections.get(sectionForNote(note))!.push(note);

  let body = `${lede.trim()}\n\n## What landed in this release\n`;
  body += `\n${ordered.length} ${ordered.length === 1 ? "change" : "changes"} shipped.\n`;
  for (const [name, list] of sections) {
    if (list.length === 0) continue;
    body += `\n### ${name}\n\n`;
    for (const note of list) {
      body += `- **${note.title}**${note.summary ? `\n  ${note.summary}` : ""}\n`;
    }
  }
  return body;
}
