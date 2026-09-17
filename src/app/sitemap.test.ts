import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ host: "ahousedividedgame.com", wikiDisabled: false }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: state.host }),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/collections", () => ({
  getGameStateCollection: async () => ({
    findOne: async () => ({ wikiDisabled: state.wikiDisabled }),
  }),
}));
vi.mock("@/lib/wiki/getWikiPageData", () => ({
  getAllWikiPagesForDisplay: async () => [
    { slug: "getting-started", category: "getting-started", updatedAt: new Date("2026-09-01") },
    { slug: "unfinished", category: "getting-started" },
    { slug: "old-alias", category: "getting-started" },
  ],
}));
vi.mock("@/lib/wiki/categories", () => ({ getCategoryById: (id: string) => ({ slug: id }) }));
vi.mock("@/lib/wiki/redirects", () => ({
  getRedirectTarget: (slug: string) => (slug === "old-alias" ? "getting-started" : null),
}));
vi.mock("@/lib/wiki/starterStub", () => ({ getLowValueWikiSlugs: async () => ["unfinished"] }));
vi.mock("@/lib/changelog/posts", () => ({ loadPublicPosts: () => [] }));

import sitemap from "./sitemap";
import robots from "./robots";

describe("canonical sitemap hosts", () => {
  beforeEach(() => {
    state.host = "ahousedividedgame.com";
    state.wikiDisabled = false;
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://ahousedividedgame.com");
  });

  it("keeps game URLs on the game host and advertises its sitemap", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain("https://ahousedividedgame.com/guides/commodities");
    expect(urls.every((url) => !url.includes("/wiki"))).toBe(true);
    expect((await robots()).sitemap).toBe("https://ahousedividedgame.com/sitemap.xml");
  });

  it("lists only canonical wiki URLs on the wiki host and filters incomplete pages and aliases", async () => {
    state.host = "wiki.ahousedividedgame.com";
    expect((await sitemap()).map((entry) => entry.url)).toEqual([
      "https://wiki.ahousedividedgame.com/",
      "https://wiki.ahousedividedgame.com/category/getting-started",
      "https://wiki.ahousedividedgame.com/getting-started",
    ]);
    expect((await robots()).sitemap).toBe("https://wiki.ahousedividedgame.com/sitemap.xml");
  });

  it("omits disabled wiki content", async () => {
    state.host = "wiki.ahousedividedgame.com";
    state.wikiDisabled = true;
    expect(await sitemap()).toEqual([]);
  });
});
