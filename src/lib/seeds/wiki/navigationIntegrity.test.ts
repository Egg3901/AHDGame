import { describe, expect, it } from "vitest";
import { LEARNING_PATHS } from "@/lib/wiki/learningPaths";
import { WIKI_REDIRECTS } from "@/lib/wiki/redirects";
import { WIKI_SEED_PAGES } from "./pages";

const specialWikiRoutes = new Set(["elections", "random-events", "roadmap"]);
const specialWikiPrefixes = ["elections/", "party/", "seat/", "leadership/", "paths/"];

function isSpecialWikiTarget(target: string): boolean {
  return (
    specialWikiRoutes.has(target) || specialWikiPrefixes.some((prefix) => target.startsWith(prefix))
  );
}

function normalizeRedirectTarget(target: string): string {
  return target.replace(/^\/wiki\//, "").replace(/^\//, "");
}

describe("wiki navigation integrity", () => {
  const seededSlugs = new Set(WIKI_SEED_PAGES.map((page) => page.slug));

  it("keeps seeded slugs unique", () => {
    expect(seededSlugs.size).toBe(WIKI_SEED_PAGES.length);
  });

  it("points every compatibility redirect at a seeded page or special route", () => {
    for (const [alias, rawTarget] of Object.entries(WIKI_REDIRECTS)) {
      const target = normalizeRedirectTarget(rawTarget);
      expect(seededSlugs.has(target) || isSpecialWikiTarget(target), `${alias} -> ${target}`).toBe(
        true
      );
    }
  });

  it("uses seeded pages for every learning-path step", () => {
    for (const path of LEARNING_PATHS) {
      for (const page of path.pages) {
        expect(seededSlugs.has(page.slug), `${path.slug} -> ${page.slug}`).toBe(true);
      }
    }
  });

  it("uses canonical seeded slugs for links inside seeded content", () => {
    for (const page of WIKI_SEED_PAGES) {
      const targets = [...page.content.matchAll(/\]\(\/wiki\/([^\s)#?]+)(?:#[^)]+)?\)/g)].map(
        (match) => match[1]
      );

      for (const target of targets) {
        if (isSpecialWikiTarget(target)) continue;
        expect(
          WIKI_REDIRECTS[target],
          `${page.slug} uses redirect alias ${target}`
        ).toBeUndefined();
        expect(seededSlugs.has(target), `${page.slug} -> ${target}`).toBe(true);
      }
    }
  });
});
