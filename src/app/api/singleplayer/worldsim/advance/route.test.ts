import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSingleplayer, advanceWorldsim, getDb, getSingleplayerConfig } = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  advanceWorldsim: vi.fn(),
  getDb: vi.fn(),
  getSingleplayerConfig: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({ requireSingleplayer }));
vi.mock("@/lib/mongodb", () => ({ getDb }));
vi.mock("@/lib/singleplayerServer", () => ({ getSingleplayerConfig }));
vi.mock("@/lib/singleplayerWorld", () => ({
  MAX_WORLD_SIM_BATCH_TURNS: 12,
  advanceWorldsim,
}));

import { POST } from "./route";

describe("POST /api/singleplayer/worldsim/advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSingleplayer.mockReturnValue(null);
    getDb.mockResolvedValue({
      collection: () => ({ countDocuments: vi.fn().mockResolvedValue(0) }),
    });
    getSingleplayerConfig.mockResolvedValue({ mode: "worldsim" });
    advanceWorldsim.mockResolvedValue({ completed: 2, finalTurn: 3, results: [] });
  });

  it("validates turns before invoking the real turn runner", async () => {
    const response = await POST(
      new Request("http://localhost/api/singleplayer/worldsim/advance", {
        method: "POST",
        body: JSON.stringify({ turns: 0 }),
        headers: { "content-type": "application/json" },
      })
    );

    expect(response.status).toBe(400);
    expect(advanceWorldsim).not.toHaveBeenCalled();
  });

  it("passes the bounded request to the authoritative runner", async () => {
    const response = await POST(
      new Request("http://localhost/api/singleplayer/worldsim/advance", {
        method: "POST",
        body: JSON.stringify({ turns: 2 }),
        headers: { "content-type": "application/json" },
      })
    );

    expect(response.status).toBe(200);
    expect(advanceWorldsim).toHaveBeenCalledWith(2);
  });
});
