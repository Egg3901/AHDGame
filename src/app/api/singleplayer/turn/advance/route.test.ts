import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSingleplayer, getDb, getSingleplayerConfig, processTurn } = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  getDb: vi.fn(),
  getSingleplayerConfig: vi.fn(),
  processTurn: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({ requireSingleplayer }));
vi.mock("@/lib/mongodb", () => ({ getDb }));
vi.mock("@/lib/singleplayerServer", () => ({ getSingleplayerConfig }));
vi.mock("@/lib/turnSystem", () => ({ processTurn }));

import { POST } from "./route";

describe("POST /api/singleplayer/turn/advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSingleplayer.mockReturnValue(null);
    getDb.mockResolvedValue({});
    getSingleplayerConfig.mockResolvedValue({ mode: "normal" });
    processTurn.mockResolvedValue({
      success: true,
      turn: 2,
      message: "Turn complete",
      warnings: [],
    });
  });

  it("does not expose a player turn control for a worldsim", async () => {
    getSingleplayerConfig.mockResolvedValue({ mode: "worldsim" });

    const response = await POST(
      new Request("http://localhost/api/singleplayer/turn/advance", { method: "POST" })
    );

    expect(response.status).toBe(409);
    expect(processTurn).not.toHaveBeenCalled();
  });

  it("runs exactly one authoritative turn for a player world", async () => {
    const response = await POST(
      new Request("http://localhost/api/singleplayer/turn/advance", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(processTurn).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({ success: true, turn: 2 });
  });
});
