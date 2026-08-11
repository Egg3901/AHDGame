// POST /api/admin/alts/digest tests. `runAltDigest` itself is exercised in
// `src/lib/altDetection/digest.test.ts`; this suite only covers the route's
// auth gating and its plumbing (db lookup, adminUrl, result passthrough).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/altDetection/digest", () => ({ runAltDigest: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

function postRequest(url = "https://ahousedivided.example/api/admin/alts/digest") {
  return new Request(url, { method: "POST" });
}

async function mockAdmin(ok: boolean) {
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  if (ok) {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "a1", username: "admin1", isAdmin: true },
    } as Awaited<ReturnType<typeof requireAdmin>>);
  } else {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireAdmin>>);
  }
}

describe("POST /api/admin/alts/digest", () => {
  it("returns 403 for a non-admin caller and never runs the digest", async () => {
    await mockAdmin(false);
    const { runAltDigest } = await import("@/lib/altDetection/digest");

    const { POST } = await import("./route");
    const res = await POST(postRequest());
    expect(res.status).toBe(403);
    expect(runAltDigest).not.toHaveBeenCalled();
  });

  it("runs the digest for an admin and returns its result", async () => {
    await mockAdmin(true);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({} as Db);
    const { runAltDigest } = await import("@/lib/altDetection/digest");
    vi.mocked(runAltDigest).mockResolvedValue({
      enabled: true,
      webhookConfigured: true,
      newClusterCount: 2,
      reportedInBody: 2,
      posted: true,
      durationMs: 12,
    });

    const { POST } = await import("./route");
    const res = await POST(postRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      enabled: true,
      webhookConfigured: true,
      newClusterCount: 2,
      reportedInBody: 2,
      posted: true,
      durationMs: 12,
    });
  });

  it("passes an Alts admin deep link as adminUrl", async () => {
    await mockAdmin(true);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({} as Db);
    const { runAltDigest } = await import("@/lib/altDetection/digest");
    vi.mocked(runAltDigest).mockResolvedValue({
      enabled: true,
      webhookConfigured: false,
      newClusterCount: 0,
      reportedInBody: 0,
      posted: false,
      durationMs: 5,
    });

    const { POST } = await import("./route");
    await POST(postRequest("https://ahousedivided.example/api/admin/alts/digest"));

    expect(runAltDigest).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        adminUrl: "https://ahousedivided.example/admin?tab=players&sub=alts",
      })
    );
  });

  it("surfaces a route-level error via handleRouteError when getDb throws", async () => {
    await mockAdmin(true);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockRejectedValue(new Error("mongo down"));

    const { POST } = await import("./route");
    const res = await POST(postRequest());
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
