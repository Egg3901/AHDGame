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
  new Request("http://localhost/api/singleplayer/setup", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("POST /api/singleplayer/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSingleplayer.mockReturnValue(null);
    mocks.getDb.mockResolvedValue({});
    mocks.resetAndBootstrapGameWorld.mockResolvedValue({ reset: { ok: true } });
    mocks.setSingleplayerConfig.mockResolvedValue({ mode: "worldsim" });
  });

  it("denies before reset and forwards worldsim setup", async () => {
    const denied = new Response("local only", { status: 403 });
    mocks.requireSingleplayer.mockReturnValueOnce(denied);
    expect(await POST(request({ mode: "worldsim" }))).toBe(denied);
    expect(mocks.resetAndBootstrapGameWorld).not.toHaveBeenCalled();

    await POST(
      request({
        preset: "2023-default",
        mode: "worldsim",
        difficulty: "hard",
        autonomyLevel: "v2",
        featureFlags: { forexEnabled: true },
      })
    );
    expect(mocks.setSingleplayerConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mode: "worldsim",
        difficulty: "hard",
        nppAutonomyLevel: "v2",
        featureFlags: { forexEnabled: true },
        permanentHeadOfState: false,
      })
    );
    expect(mocks.resetAndBootstrapGameWorld).toHaveBeenCalledWith(
      expect.objectContaining({ skipDiagnostic: true })
    );
  });

  it("forwards head-of-state mode and rejects invalid setup before reset", async () => {
    expect((await POST(request({ mode: "sandbox" }))).status).toBe(400);
    expect(mocks.resetAndBootstrapGameWorld).not.toHaveBeenCalled();
    await POST(
      request({
        preset: "2019-default",
        mode: "head-of-state",
        difficulty: "easy",
        autonomyLevel: "off",
      })
    );
    expect(mocks.setSingleplayerConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "head-of-state", permanentHeadOfState: true })
    );
  });

  it("accepts the v5 autonomy tier", async () => {
    await POST(
      request({ preset: "2023-default", mode: "normal", difficulty: "normal", autonomyLevel: "v5" })
    );
    expect(mocks.setSingleplayerConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nppAutonomyLevel: "v5" })
    );
  });

  it("still rejects a level that does not exist", async () => {
    expect((await POST(request({ mode: "normal", autonomyLevel: "v6" }))).status).toBe(400);
    expect(mocks.setSingleplayerConfig).not.toHaveBeenCalled();
  });

  /**
   * The two axes are independent. Difficulty must never move the autonomy tier,
   * and the tier must never move difficulty — otherwise "hard" would silently be
   * an autonomy unlock and the disclosure to the player would be a lie.
   */
  it("keeps difficulty and autonomy independent", async () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      vi.clearAllMocks();
      mocks.requireSingleplayer.mockReturnValue(null);
      mocks.getDb.mockResolvedValue({});
      mocks.resetAndBootstrapGameWorld.mockResolvedValue({ reset: { ok: true } });
      mocks.setSingleplayerConfig.mockResolvedValue({ mode: "normal" });
      await POST(
        request({ preset: "2023-default", mode: "normal", difficulty, autonomyLevel: "v5" })
      );
      expect(mocks.setSingleplayerConfig).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ difficulty, nppAutonomyLevel: "v5" })
      );
    }
  });

  it("defaults an omitted level to v4, never to v5", async () => {
    await POST(request({ preset: "2023-default", mode: "normal", difficulty: "normal" }));
    expect(mocks.setSingleplayerConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nppAutonomyLevel: "v4" })
    );
  });
});
