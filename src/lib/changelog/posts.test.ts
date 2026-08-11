import { describe, it, expect } from "vitest";
import { parseFrontmatter, asString, asStringArray } from "./frontmatter";
import {
  compareVersionsDesc,
  groupPostsByMonth,
  postMatchesFilters,
  searchableProse,
} from "./postUtils";
import type { ChangelogPost } from "./types";

describe("parseFrontmatter", () => {
  it("parses scalar and array fields", () => {
    const raw = `---
version: "0.4.0"
date: 2026-07-03
title: Test Release
summary: Short summary
tags: [mechanics, ui]
badges: [major]
era: Beta 2
---
Body paragraph one.

## Section
- bullet
`;
    const { data, content } = parseFrontmatter(raw);
    expect(asString(data.version)).toBe("0.4.0");
    expect(asString(data.title)).toBe("Test Release");
    expect(asStringArray(data.tags)).toEqual(["mechanics", "ui"]);
    expect(content).toContain("Body paragraph one");
  });

  it("parses folded block scalars", () => {
    const raw = `---
summary: >-
  Line one
  line two
---
Body
`;
    const { data } = parseFrontmatter(raw);
    expect(asString(data.summary)).toBe("Line one\nline two");
  });
});

describe("compareVersionsDesc", () => {
  it("sorts semver newest first", () => {
    expect(compareVersionsDesc("0.4.0", "0.3.6")).toBeLessThan(0);
    expect(compareVersionsDesc("0.3.6", "0.4.0")).toBeGreaterThan(0);
    expect(compareVersionsDesc("0.4.0", "0.4.0")).toBe(0);
  });
});

describe("groupPostsByMonth", () => {
  it("groups posts under YYYY-MM keys", () => {
    const posts: ChangelogPost[] = [
      {
        slug: "0.4.0",
        version: "0.4.0",
        date: "2026-07-03",
        title: "A",
        summary: "",
        tags: [],
        badges: ["major"],
        body: "",
      },
      {
        slug: "0.3.6",
        version: "0.3.6",
        date: "2026-06-27",
        title: "B",
        summary: "",
        tags: [],
        badges: ["major"],
        body: "",
      },
    ];
    const groups = groupPostsByMonth(posts);
    expect(groups).toHaveLength(2);
    expect(groups[0].month).toBe("2026-07");
    expect(groups[0].posts).toHaveLength(1);
  });
});

describe("postMatchesFilters", () => {
  const post: ChangelogPost = {
    slug: "0.4.0",
    version: "0.4.0",
    date: "2026-07-03",
    title: "Demographics",
    summary: "Layer-1 overhaul",
    tags: ["demographics", "mechanics"],
    badges: ["major"],
    era: "Beta 2",
    areas: ["backend"],
    body: "calibration suite",
  };

  it("matches search across fields", () => {
    expect(postMatchesFilters(post, { search: "calibration" })).toBe(true);
    expect(postMatchesFilters(post, { search: "missing" })).toBe(false);
  });

  it("filters by tag, badge, era, and area", () => {
    expect(postMatchesFilters(post, { tag: "mechanics" })).toBe(true);
    expect(postMatchesFilters(post, { tag: "ui" })).toBe(false);
    expect(postMatchesFilters(post, { badge: "major" })).toBe(true);
    expect(postMatchesFilters(post, { era: "Beta 2" })).toBe(true);
    expect(postMatchesFilters(post, { area: "backend" })).toBe(true);
    expect(postMatchesFilters(post, { area: "frontend" })).toBe(false);
  });
});

describe("searchableProse", () => {
  it("drops chart specs so a search for chart JSON does not match", () => {
    const body = 'Intro text.\n\n```chart\n{ "type": "bar", "title": "Seats" }\n```\n\nAfter.';
    const prose = searchableProse(body);
    expect(prose).toContain("Intro text.");
    expect(prose).toContain("After.");
    expect(prose).not.toContain("bar");
    expect(prose).not.toContain("type");
  });

  it("keeps link text but drops the URL", () => {
    expect(searchableProse("See the [wiki page](/wiki/corporations) for more.")).toBe(
      "See the wiki page for more."
    );
  });

  it("drops image markup entirely", () => {
    expect(searchableProse("Before ![A caption](/changelog/x.png) after.")).toBe("Before after.");
  });
});

describe("searchableProse and chart captions", () => {
  const body =
    'Intro.\n\n```chart\n{ "type": "bar", "title": "Seats in 1953", "categories": ["a"], "caption": "Alaska was a territory." }\n```\n\nAfter.';

  it("keeps a chart's title and caption searchable", () => {
    const prose = searchableProse(body);
    expect(prose).toContain("Seats in 1953");
    expect(prose).toContain("Alaska was a territory.");
  });

  it("still drops the chart's machinery", () => {
    const prose = searchableProse(body);
    expect(prose).not.toContain("categories");
    expect(prose).not.toContain('"bar"');
  });
});

describe("parseFrontmatter with wrapped flow arrays", () => {
  // Prettier reformats content/*.md, so a long tag list ends up wrapped across
  // lines. Before this was handled it parsed as a single tag containing the
  // literal brackets, which surfaced as a junk filter chip on /changelog.
  it("parses a multi-line flow array as a list, not one string", () => {
    const raw = [
      "---",
      'version: "0.4.1"',
      'date: "2026-07-06"',
      'title: "T"',
      "tags:",
      "  [",
      "    mechanics,",
      "    corporations,",
      "    brand-loyalty,",
      "  ]",
      "badges: [major]",
      "---",
      "Body.",
    ].join("\n");
    const { data, content } = parseFrontmatter(raw);
    expect(data.tags).toEqual(["mechanics", "corporations", "brand-loyalty"]);
    expect(data.badges).toEqual(["major"]);
    expect(content).toBe("Body.");
  });

  it("still parses a single-line flow array", () => {
    const raw = ["---", 'title: "T"', "tags: [a, b]", "---", "Body."].join("\n");
    expect(parseFrontmatter(raw).data.tags).toEqual(["a", "b"]);
  });
});
