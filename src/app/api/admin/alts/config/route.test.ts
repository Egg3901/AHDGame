import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  DEFAULT_ALT_SCORING_THRESHOLDS,
  DEFAULT_ALT_SCORING_WEIGHTS,
} from "@/lib/altDetection/config";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameConfig");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

async function mockModerator(isAdmin = false) {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { userId: "u1", username: "mod1", isAdmin },
  } as Awaited<ReturnType<typeof requireModerator>>);
}

function putRequest(body: unknown) {
  return new Request("http://localhost/api/admin/alts/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/admin/alts/config", () => {
  it("returns 403 when not staff", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireModerator>>);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("is readable by a plain moderator and returns the plan §3.2 defaults absent an override", async () => {
    await mockModerator(false);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.weights).toEqual(DEFAULT_ALT_SCORING_WEIGHTS);
    expect(data.thresholds).toEqual(DEFAULT_ALT_SCORING_THRESHOLDS);
  });

  it("merges a stored partial override onto the defaults", async () => {
    await mockModerator(false);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      altScoring: { weights: { oauth_shared: 0.99 }, thresholds: { cluster: 0.75 } },
    });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();
    expect(data.weights.oauth_shared).toBe(0.99);
    expect(data.weights.device_fingerprint_exact).toBe(
      DEFAULT_ALT_SCORING_WEIGHTS.device_fingerprint_exact
    );
    expect(data.thresholds.cluster).toBe(0.75);
    expect(data.thresholds.link).toBe(DEFAULT_ALT_SCORING_THRESHOLDS.link);
  });
});

describe("PUT /api/admin/alts/config", () => {
  it("is rejected for a moderator (admin-only capability, plan §4.6)", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireAdmin>>);

    const { PUT } = await import("./route");
    const res = await PUT(putRequest({ weights: { oauth_shared: 0.5 } }));
    expect(res.status).toBe(403);
    expect(db.collectionMocks.gameConfig.updateOne).not.toHaveBeenCalled();
  });

  it("persists a valid override for an admin and logs the change", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "a1", username: "admin1", isAdmin: true },
    } as Awaited<ReturnType<typeof requireAdmin>>);

    const { PUT } = await import("./route");
    const res = await PUT(
      putRequest({ weights: { oauth_shared: 0.99 }, thresholds: { link: 0.4 } })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.weights.oauth_shared).toBe(0.99);
    expect(data.thresholds.link).toBe(0.4);

    expect(db.collectionMocks.gameConfig.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({
        $set: expect.objectContaining({
          altScoring: expect.objectContaining({
            weights: expect.objectContaining({ oauth_shared: 0.99 }),
          }),
          altScoringUpdatedBy: "admin1",
        }),
      }),
      { upsert: true }
    );

    const { createAdminLog } = await import("@/lib/adminLog");
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "alt_scoring_config_updated", username: "admin1" })
    );
  });

  it("drops out-of-range values instead of persisting them (fail-closed, reuses config.ts merge)", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "a1", username: "admin1", isAdmin: true },
    } as Awaited<ReturnType<typeof requireAdmin>>);

    const { PUT } = await import("./route");
    const res = await PUT(putRequest({ weights: { oauth_shared: 5 } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.weights.oauth_shared).toBe(DEFAULT_ALT_SCORING_WEIGHTS.oauth_shared);
  });

  it("rejects a malformed body with 400", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "a1", username: "admin1", isAdmin: true },
    } as Awaited<ReturnType<typeof requireAdmin>>);

    const { PUT } = await import("./route");
    const res = await PUT(putRequest({ weights: "not-an-object" }));
    expect(res.status).toBe(400);
    expect(db.collectionMocks.gameConfig.updateOne).not.toHaveBeenCalled();
  });
});
