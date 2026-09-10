import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  getDb: vi.fn(),
  ensureSingleplayerUser: vi.fn(),
  resetAndBootstrapGameWorld: vi.fn(),
  setSingleplayerConfig: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({
  requireSingleplayer: mocks.requireSingleplayer,
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/singleplayerServer", () => ({
  ensureSingleplayerUser: mocks.ensureSingleplayerUser,
  setSingleplayerConfig: mocks.setSingleplayerConfig,
}));
vi.mock("@/lib/admin/resetAndBootstrapGameWorld", () => ({
  resetAndBootstrapGameWorld: mocks.resetAndBootstrapGameWorld,
}));

import { POST } from "./route";

const request = (body: unknown) =>
  new Request("http://localhost/api/singleplayer/new-game", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/singleplayer/new-game", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSingleplayer.mockReturnValue(null);
    mocks.getDb.mockResolvedValue({});
    mocks.resetAndBootstrapGameWorld.mockResolvedValue({ reset: { ok: true } });
    mocks.setSingleplayerConfig.mockResolvedValue({ mode: "normal" });
  });

  it("denies before touching the database or reset", async () => {
    const denied = new Response("local only", { status: 403 });
    mocks.requireSingleplayer.mockReturnValue(denied);
    await expect(POST(request({ mode: "worldsim" }))).resolves.toBe(denied);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.resetAndBootstrapGameWorld).not.toHaveBeenCalled();
  });

  it("rejects unknown presets and modes before reset", async () => {
    expect((await POST(request({ preset: "future" }))).status).toBe(400);
    expect((await POST(request({ mode: "sandbox" }))).status).toBe(400);
    expect(mocks.resetAndBootstrapGameWorld).not.toHaveBeenCalled();
  });

  it("keeps the empty body compatible with normal defaults", async () => {
    expect((await POST(request({}))).status).toBe(200);
    expect(mocks.resetAndBootstrapGameWorld).toHaveBeenCalledWith(
      expect.objectContaining({ preset: "2019-default", skipDiagnostic: true, recordRunLog: false })
    );
    expect(mocks.setSingleplayerConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "normal", difficulty: "normal", nppAutonomyLevel: "v4" })
    );
  });
});
