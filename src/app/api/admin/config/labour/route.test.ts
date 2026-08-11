import { describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn(async () => undefined) }));
// The real seeder walks states/unions; this suite asserts only the flip-to-full
// trigger contract (called once, reset:false, era preset threaded through).
vi.mock("@/lib/admin/seed/seedUnions", () => ({ seedUnions: vi.fn(async () => 42) }));

function makeRequest(mode: string) {
  return new Request("http://localhost/api/admin/config/labour", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

describe("PATCH /api/admin/config/labour — auto-seed unions on flip to full", () => {
  let db: MockDb;

  async function setup(priorMode: string | undefined, preset?: string) {
    vi.clearAllMocks();
    db = createMockDb();
    // getLabourSystemMode reads gameConfig for the prior mode.
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue(
      priorMode ? { _id: "default", labourSystemMode: priorMode } : null
    );
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue(preset ? { preset } : null);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  }

  it("seeds unions (reset:false, world preset) when the mode rises to full, and reports the count", async () => {
    await setup("unions", "1991-default");
    const { PATCH } = await import("./route");
    const { seedUnions } = await import("@/lib/admin/seed/seedUnions");

    const res = await PATCH(makeRequest("full"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, mode: "full", priorMode: "unions" });
    expect(body.unionsSeeded).toBe(42);

    expect(seedUnions).toHaveBeenCalledTimes(1);
    const [, , preset, reset] = vi.mocked(seedUnions).mock.calls[0];
    expect(preset).toBe("1991-default");
    expect(reset).toBe(false);
  });

  it("falls back to the named default preset when GameState.preset is absent", async () => {
    await setup("off");
    const { PATCH } = await import("./route");
    const { seedUnions } = await import("@/lib/admin/seed/seedUnions");

    const res = await PATCH(makeRequest("full"));
    expect(res.status).toBe(200);

    expect(seedUnions).toHaveBeenCalledTimes(1);
    // Previously this passed `undefined` and relied on seedUnions' own
    // parameter default. That default is gone — a forgotten `preset` is now a
    // compile error — so the fallback is explicit and named at the call site.
    const [, , preset] = vi.mocked(seedUnions).mock.calls[0];
    expect(preset).toBe(DEFAULT_SEED_PRESET);
  });

  it("still returns 200 with the mode persisted when the backfill throws, reporting seedError", async () => {
    await setup("unions");
    const { PATCH } = await import("./route");
    const { seedUnions } = await import("@/lib/admin/seed/seedUnions");
    vi.mocked(seedUnions).mockRejectedValueOnce(new Error("mid-loop write failure"));

    const res = await PATCH(makeRequest("full"));
    const body = await res.json();

    // The mode write commits before the seed runs; a 500 here would strand
    // the world at "full" with a partial roster and no retry path (the next
    // PATCH sees priorMode "full" and skips the backfill).
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, mode: "full", priorMode: "unions" });
    expect(body.seedError).toBe("mid-loop write failure");
    expect(body.unionsSeeded).toBeUndefined();
  });

  it("does NOT seed when re-PATCHing full over full", async () => {
    await setup("full");
    const { PATCH } = await import("./route");
    const { seedUnions } = await import("@/lib/admin/seed/seedUnions");

    const res = await PATCH(makeRequest("full"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(seedUnions).not.toHaveBeenCalled();
    expect(body.unionsSeeded).toBeUndefined();
  });

  it("does NOT seed for any target mode below full", async () => {
    await setup("off");
    const { PATCH } = await import("./route");
    const { seedUnions } = await import("@/lib/admin/seed/seedUnions");

    const res = await PATCH(makeRequest("unions"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(seedUnions).not.toHaveBeenCalled();
    expect(body.unionsSeeded).toBeUndefined();
  });
});
