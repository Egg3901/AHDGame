import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/api/wikiGuard", () => ({ checkWikiDisabled: vi.fn() }));
vi.mock("@/lib/api/rateLimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/rateLimit")>("@/lib/api/rateLimit");
  return {
    ...actual,
    checkRateLimit: vi.fn(),
    rateLimitResponse: actual.rateLimitResponse,
  };
});

let db: MockDb;

function post(body: unknown, ip = "203.0.113.10") {
  return new Request("http://localhost/api/wiki/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wiki/report", () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    db = createMockDb();
    db.collection("wikiReports");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const { checkWikiDisabled } = await import("@/lib/api/wikiGuard");
    vi.mocked(checkWikiDisabled).mockResolvedValue(null);
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 5,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.WIKI_REPORT_ENDPOINT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WIKI_REPORT_ENDPOINT;
  });

  it("stores a report and returns success without a relay endpoint", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post({ slug: "getting-started", reason: "stale", note: "Donor costs changed" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(db.collectionMocks.wikiReports.insertOne).toHaveBeenCalledOnce();
    const inserted = db.collectionMocks.wikiReports.insertOne.mock.calls[0][0];
    expect(inserted.slug).toBe("getting-started");
    expect(inserted.reason).toBe("stale");
    expect(inserted.note).toBe("Donor costs changed");
    expect(inserted.ip).toBe("203.0.113.10");
    expect(inserted.relayAttempted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays to WIKI_REPORT_ENDPOINT when set", async () => {
    process.env.WIKI_REPORT_ENDPOINT = "https://example.test/wiki-reports";
    const { POST } = await import("./route");
    const res = await POST(post({ slug: "primaries", reason: "incorrect" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/wiki-reports",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const inserted = db.collectionMocks.wikiReports.insertOne.mock.calls[0][0];
    expect(inserted.relayAttempted).toBe(true);
  });

  it("rejects invalid reason with 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ slug: "getting-started", reason: "typo" }));
    expect(res.status).toBe(400);
    expect(db.collectionMocks.wikiReports.insertOne).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    const { checkRateLimit, rateLimitResponse } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: false,
      limit: 5,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      retryAfter: 30,
    });
    const { POST } = await import("./route");
    const res = await POST(post({ slug: "getting-started", reason: "other" }));
    expect(res.status).toBe(429);
    expect(rateLimitResponse).toBeDefined();
    expect(db.collectionMocks.wikiReports.insertOne).not.toHaveBeenCalled();
  });

  it("returns 403 when the wiki is disabled", async () => {
    const { checkWikiDisabled } = await import("@/lib/api/wikiGuard");
    vi.mocked(checkWikiDisabled).mockResolvedValue(
      NextResponse.json({ error: "Wiki is currently disabled" }, { status: 403 })
    );
    const { POST } = await import("./route");
    const res = await POST(post({ slug: "getting-started", reason: "stale" }));
    expect(res.status).toBe(403);
  });

  it("attaches the logged-in user when present", async () => {
    const userId = new ObjectId();
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: userId.toString() } as never);
    const { POST } = await import("./route");
    await POST(
      post({ slug: "getting-started", reason: "update-request", note: "  add week-two  " })
    );
    const inserted = db.collectionMocks.wikiReports.insertOne.mock.calls[0][0];
    expect(inserted.userId.toString()).toBe(userId.toString());
    expect(inserted.note).toBe("add week-two");
  });
});
