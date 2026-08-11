import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/altDetection/tuning", () => ({ computeTuningSuggestions: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("altClusters");
  db.collection("gameConfig");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("GET /api/admin/alts/tuning", () => {
  it("returns 403 for a non-admin (moderator-only auth is not enough — this is admin-depth tuning)", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireAdmin>>);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(403);

    const { computeTuningSuggestions } = await import("@/lib/altDetection/tuning");
    expect(computeTuningSuggestions).not.toHaveBeenCalled();
  });

  it("returns the tuning report for an admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "a1", username: "admin1", isAdmin: true },
    } as Awaited<ReturnType<typeof requireAdmin>>);

    const { computeTuningSuggestions } = await import("@/lib/altDetection/tuning");
    const fakeReport = {
      generatedAt: new Date("2026-01-01T00:00:00Z"),
      confirmedTotal: 3,
      dismissedTotal: 2,
      lowConfidence: true,
      minSignalSamples: 5,
      minTotalClusters: 10,
      maxWeightDelta: 0.15,
      method: "test method",
      suggestions: [
        {
          signal: "oauth_shared",
          currentWeight: 0.97,
          suggestedWeight: 0.97,
          confirmedCount: 1,
          dismissedCount: 0,
          confirmedRate: 0.33,
          dismissedRate: 0,
          discrimination: 0.33,
          lowConfidence: true,
          rationale: "thin sample",
        },
      ],
    };
    vi.mocked(computeTuningSuggestions).mockResolvedValue(
      fakeReport as unknown as Awaited<ReturnType<typeof computeTuningSuggestions>>
    );

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.confirmedTotal).toBe(3);
    expect(data.dismissedTotal).toBe(2);
    expect(data.suggestions).toHaveLength(1);
    expect(data.suggestions[0].signal).toBe("oauth_shared");
    expect(computeTuningSuggestions).toHaveBeenCalledWith(db);
  });
});
