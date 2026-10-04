import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { NextResponse } from "next/server";

vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/admin/recover1991Bootstrap", () => ({
  BootstrapRecoveryConflict: class extends Error {},
  preview1991BootstrapRecovery: vi.fn(),
  recover1991Bootstrap: vi.fn(),
}));
const { POST } = await import("./route");
const { requireAdmin } = await import("@/lib/api/requireAdmin");
const { getDb } = await import("@/lib/mongodb");
const { preview1991BootstrapRecovery, recover1991Bootstrap, BootstrapRecoveryConflict } =
  await import("@/lib/admin/recover1991Bootstrap");
const runId = "507f1f77bcf86cd799439011";
const request = (body: object) =>
  new Request("http://localhost/api/admin/reset/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "operator" } } as never);
  vi.mocked(getDb).mockResolvedValue({} as Db);
  vi.mocked(preview1991BootstrapRecovery).mockResolvedValue({
    ready: true,
    runId,
    preset: "1991-default",
    startingParties: "none",
    unownedSectors: 2791,
  });
  vi.mocked(recover1991Bootstrap).mockResolvedValue({
    status: "succeeded",
    diagnostics: { ok: 1, warn: 0, critical: 0 },
    failures: [],
    logs: [],
  });
});

describe("bootstrap recovery route", () => {
  it("denies non-admin requests before touching the database", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new NextResponse(null, { status: 403 }),
    });
    expect((await POST(request({ runId, apply: true }))).status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });
  it("validates the exact run and defaults to a read-only preview", async () => {
    expect((await POST(request({ runId: "bad" }))).status).toBe(400);
    const response = await POST(request({ runId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ready: true, runId });
    expect(recover1991Bootstrap).not.toHaveBeenCalled();
  });
  it("returns conflict without recovery when guards reject the world", async () => {
    vi.mocked(preview1991BootstrapRecovery).mockRejectedValue(
      new BootstrapRecoveryConflict("changed")
    );
    expect((await POST(request({ runId, apply: true }))).status).toBe(409);
    expect(recover1991Bootstrap).not.toHaveBeenCalled();
  });
  it("streams a terminal result after an explicitly applied recovery", async () => {
    const response = await POST(request({ runId, apply: true }));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await response.text()).toContain('"type":"done"');
    expect(recover1991Bootstrap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runId, adminUsername: "operator" })
    );
  });
  it("streams a terminal error rather than presenting failure as success", async () => {
    vi.mocked(recover1991Bootstrap).mockRejectedValue(new Error("seed failed"));
    const response = await POST(request({ runId, apply: true }));
    const text = await response.text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"done"');
  });
});
