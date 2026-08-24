import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { WikiSearchCandidate } from "@/lib/wiki/wikiSearch";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/api/wikiGuard", () => ({ checkWikiDisabled: vi.fn() }));
vi.mock("@/lib/wiki/wikiSearchSources", () => ({
  getNonPageWikiSearchCandidates: vi.fn(),
}));

let db: MockDb;

interface PageDoc {
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
  featured?: boolean;
}

function givenPages(docs: PageDoc[]) {
  const cursor = db.collectionMocks.wikiPages.find();
  cursor.toArray.mockResolvedValue(docs);
}

async function givenNonPageCandidates(candidates: WikiSearchCandidate[]) {
  const { getNonPageWikiSearchCandidates } = await import("@/lib/wiki/wikiSearchSources");
  vi.mocked(getNonPageWikiSearchCandidates).mockResolvedValue(candidates);
}

function get(query: string) {
  return new Request(`http://localhost/api/wiki/search?${query}`);
}

interface Hit {
  slug: string;
  title: string;
  href: string;
  kind: string;
}

async function hitsFor(query: string): Promise<Hit[]> {
  const { GET } = await import("./route");
  const res = await GET(get(query));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: Hit[] };
  return body.results;
}

describe("GET /api/wiki/search", () => {
  beforeEach(async () => {
    vi.resetModules();
    db = createMockDb();
    db.collection("wikiPages");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const { checkWikiDisabled } = await import("@/lib/api/wikiGuard");
    vi.mocked(checkWikiDisabled).mockResolvedValue(null);
    await givenNonPageCandidates([]);
  });

  it("returns authored pages with a wiki href and the page kind", async () => {
    givenPages([{ slug: "filibuster", title: "Filibuster" }]);

    const hits = await hitsFor("q=filibuster");

    expect(hits).toHaveLength(1);
    expect(hits[0].href).toBe("/wiki/filibuster");
    expect(hits[0].kind).toBe("page");
  });

  it("finds party pages, which have no wikiPages document", async () => {
    givenPages([]);
    await givenNonPageCandidates([
      { slug: "labour", title: "Labour Party", href: "/wiki/party/abc", kind: "party" },
    ]);

    const hits = await hitsFor("q=labour");

    expect(hits.map((h) => h.href)).toEqual(["/wiki/party/abc"]);
  });

  it("finds seat pages, which have no wikiPages document", async () => {
    givenPages([]);
    await givenNonPageCandidates([
      { slug: "ny-01", title: "New York 1st District", href: "/wiki/seat/ny-01", kind: "seat" },
    ]);

    const hits = await hitsFor("q=new+york");

    expect(hits.map((h) => h.kind)).toEqual(["seat"]);
  });

  it("ranks an exact title match above a body-only match across merged sources", async () => {
    givenPages([{ slug: "senate-procedure", title: "Senate Procedure" }]);
    await givenNonPageCandidates([
      { slug: "filibuster", title: "Filibuster", href: "/wiki/filibuster", kind: "page" },
    ]);

    const hits = await hitsFor("q=filibuster");

    expect(hits[0].title).toBe("Filibuster");
  });

  it("skips non-page surfaces when a tag filter is set, since only pages carry tags", async () => {
    givenPages([{ slug: "tagged", title: "Tagged Page", tags: ["elections"] }]);
    await givenNonPageCandidates([
      { slug: "labour", title: "Labour Party", href: "/wiki/party/abc", kind: "party" },
    ]);

    const hits = await hitsFor("q=&tags=elections");

    expect(hits.map((h) => h.kind)).toEqual(["page"]);
  });

  it("excludes private pages for anonymous visitors", async () => {
    givenPages([]);

    await hitsFor("q=secret");

    const filter = db.collectionMocks.wikiPages.find.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.private).toEqual({ $ne: true });
    expect(filter.status).toBe("published");
  });

  it("includes private pages for admins", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ isAdmin: true } as never);
    givenPages([]);

    await hitsFor("q=secret");

    const filter = db.collectionMocks.wikiPages.find.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(filter.private).toBeUndefined();
  });

  it("pulls a wider candidate pool than the requested limit so ranking has material", async () => {
    givenPages([]);

    await hitsFor("q=budget&limit=5");

    const cursor = db.collectionMocks.wikiPages.find();
    const poolSize = cursor.limit.mock.calls.at(-1)?.[0] as number;
    expect(poolSize).toBeGreaterThan(5);
  });

  it("never projects page bodies, which would ship whole articles per keystroke", async () => {
    givenPages([]);

    await hitsFor("q=budget");

    const cursor = db.collectionMocks.wikiPages.find();
    const projection = cursor.project.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(projection.content).toBeUndefined();
  });

  it("honours the requested limit after ranking", async () => {
    givenPages([]);
    await givenNonPageCandidates([
      { slug: "a", title: "Budget A", href: "/wiki/a", kind: "page" },
      { slug: "b", title: "Budget B", href: "/wiki/b", kind: "page" },
      { slug: "c", title: "Budget C", href: "/wiki/c", kind: "page" },
    ]);

    const hits = await hitsFor("q=budget&limit=2");

    expect(hits).toHaveLength(2);
  });

  it("still returns authored pages when the generated-surface source fails", async () => {
    givenPages([{ slug: "budget", title: "Budget" }]);
    const { getNonPageWikiSearchCandidates } = await import("@/lib/wiki/wikiSearchSources");
    vi.mocked(getNonPageWikiSearchCandidates).mockRejectedValue(new Error("aggregation failed"));

    const hits = await hitsFor("q=budget");

    expect(hits.map((h) => h.title)).toEqual(["Budget"]);
  });

  it("returns the guard response when the wiki is disabled", async () => {
    const { checkWikiDisabled } = await import("@/lib/api/wikiGuard");
    vi.mocked(checkWikiDisabled).mockResolvedValue(
      NextResponse.json({ error: "Wiki disabled" }, { status: 403 })
    );

    const { GET } = await import("./route");
    const res = await GET(get("q=anything"));

    expect(res.status).toBe(403);
  });
});
