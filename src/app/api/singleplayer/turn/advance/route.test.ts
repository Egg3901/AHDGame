import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSingleplayer,
  getDb,
  getSingleplayerConfig,
  processTurn,
  findOne,
  getSingleplayerWorldAvailability,
} = vi.hoisted(() => ({
  requireSingleplayer: vi.fn(),
  getDb: vi.fn(),
  getSingleplayerConfig: vi.fn(),
  processTurn: vi.fn(),
  findOne: vi.fn(),
  getSingleplayerWorldAvailability: vi.fn(),
}));

vi.mock("@/lib/api/requireSingleplayer", () => ({ requireSingleplayer }));
vi.mock("@/lib/mongodb", () => ({ getDb }));
vi.mock("@/lib/singleplayerServer", () => ({ getSingleplayerConfig }));
vi.mock("@/lib/singleplayerOperator", () => ({ getSingleplayerWorldAvailability }));
vi.mock("@/lib/turnSystem", () => ({ processTurn }));

import { POST } from "./route";

describe("POST /api/singleplayer/turn/advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSingleplayer.mockReturnValue(null);
    getDb.mockResolvedValue({ collection: () => ({ findOne }) });
    findOne.mockResolvedValue({ _id: "character" });
    getSingleplayerWorldAvailability.mockResolvedValue("off");
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

  it("locks turns until the local player has an active character", async () => {
    findOne.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/singleplayer/turn/advance", { method: "POST" })
    );
    expect(response.status).toBe(409);
    expect(processTurn).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "Create a character before ending a turn.",
    });
  });

  it("does not advance a paused world", async () => {
    getSingleplayerWorldAvailability.mockResolvedValue("full");
    const response = await POST(
      new Request("http://localhost/api/singleplayer/turn/advance", { method: "POST" })
    );
    expect(response.status).toBe(409);
    expect(processTurn).not.toHaveBeenCalled();
  });

  it("returns a committed turn with warnings as completed", async () => {
    processTurn.mockResolvedValue({
      success: false,
      turn: 2,
      message: "Completed with warnings",
      warnings: ["Optional summary unavailable"],
    });
    const response = await POST(
      new Request("http://localhost/api/singleplayer/turn/advance", { method: "POST" })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      turn: 2,
      warnings: ["Optional summary unavailable"],
    });
  });

  it("briefs the actual change in campaign funds and actions", async () => {
    findOne.mockResolvedValueOnce({
      _id: "character",
      currencyBalances: { campaign: 250000 },
      actions: 25,
    });
    findOne.mockResolvedValueOnce({ currencyBalances: { campaign: 268360 }, actions: 29 });
    const response = await POST(
      new Request("http://localhost/api/singleplayer/turn/advance", { method: "POST" })
    );
    await expect(response.json()).resolves.toMatchObject({
      briefing: { funds: 268360, fundsDelta: 18360, actions: 29, actionsDelta: 4 },
    });
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
