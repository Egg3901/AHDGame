import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "./route";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/adminLog", () => ({
  createAdminLog: vi.fn(),
}));

vi.mock("@/lib/migrations/registry", () => ({
  MIGRATIONS: [],
}));

vi.mock("@/lib/migrations/runner", () => ({
  runMigrations: vi.fn(),
}));

describe("/api/admin/config/index-funds", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  });

  it("GET returns 'off' when the gameConfig flag is absent", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const findOne = vi.fn().mockResolvedValue({ _id: "default" });
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ findOne }),
    } as never);

    const res = await GET();
    await expect(res.json()).resolves.toEqual({ mode: "off" });
    expect(res.status).toBe(200);
  });

  it("GET returns the stored mode", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const findOne = vi.fn().mockResolvedValue({ _id: "default", indexFundsMode: "partial" });
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({ findOne }),
    } as never);

    const res = await GET();
    await expect(res.json()).resolves.toEqual({ mode: "partial" });
  });

  it("PATCH updates the mode without running migrations when setting to off", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const { getDb } = await import("@/lib/mongodb");
    const { createAdminLog } = await import("@/lib/adminLog");
    const { runMigrations } = await import("@/lib/migrations/runner");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({ indexFundsMode: "full" }),
        updateOne,
      }),
    } as never);

    const res = await PATCH(
      new Request("http://localhost/api/admin/config/index-funds", {
        method: "PATCH",
        body: JSON.stringify({ mode: "off" }),
      })
    );

    await expect(res.json()).resolves.toEqual({ success: true, mode: "off", bootstrap: null });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: { indexFundsMode: "off" } },
      { upsert: true }
    );
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "index_funds_disabled", username: "admin" })
    );
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it("PATCH runs bootstrap migrations on a fresh enable (off → partial)", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const { getDb } = await import("@/lib/mongodb");
    const { runMigrations } = await import("@/lib/migrations/runner");
    vi.mocked(runMigrations).mockResolvedValue({
      ranIds: [
        "2026-06-01-index-fund-foundation",
        "2026-06-01-index-fund-seed",
        "2026-06-02-index-fund-real-bonds",
      ],
      skippedIds: [],
      results: {},
      dryRun: false,
    });
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({ indexFundsMode: "off" }),
        updateOne,
      }),
    } as never);

    const res = await PATCH(
      new Request("http://localhost/api/admin/config/index-funds", {
        method: "PATCH",
        body: JSON.stringify({ mode: "full" }),
      })
    );

    const body = await res.json();
    expect(body).toMatchObject({ success: true, mode: "full" });
    expect(body.bootstrap.ranIds).toEqual([
      "2026-06-01-index-fund-foundation",
      "2026-06-01-index-fund-seed",
      "2026-06-02-index-fund-real-bonds",
    ]);
    expect(runMigrations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dryRun: false,
        only: [
          "2026-06-01-index-fund-foundation",
          "2026-06-01-index-fund-seed",
          "2026-06-02-index-fund-real-bonds",
        ],
      })
    );
  });

  it("PATCH skips bootstrap when already enabled (partial → full)", async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const { getDb } = await import("@/lib/mongodb");
    const { runMigrations } = await import("@/lib/migrations/runner");
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({ indexFundsMode: "partial" }),
        updateOne,
      }),
    } as never);

    const res = await PATCH(
      new Request("http://localhost/api/admin/config/index-funds", {
        method: "PATCH",
        body: JSON.stringify({ mode: "full" }),
      })
    );

    await expect(res.json()).resolves.toEqual({ success: true, mode: "full", bootstrap: null });
    expect(runMigrations).not.toHaveBeenCalled();
  });
});
