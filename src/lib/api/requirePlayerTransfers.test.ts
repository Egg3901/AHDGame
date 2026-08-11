import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/collections", () => ({ getGameStateCollection: vi.fn() }));

const { getGameStateCollection } = await import("@/lib/db/collections");

describe("requirePlayerTransfersEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows transfers when the pause flag is off or missing", async () => {
    vi.mocked(getGameStateCollection).mockResolvedValue({
      findOne: vi.fn().mockResolvedValue({ _id: "current", playerTransfersPaused: false }),
    } as never);

    const { requirePlayerTransfersEnabled } = await import("./requirePlayerTransfers");
    const result = await requirePlayerTransfersEnabled({} as never);

    expect(result).toBeNull();
  });

  it("blocks transfers when the pause flag is enabled", async () => {
    vi.mocked(getGameStateCollection).mockResolvedValue({
      findOne: vi.fn().mockResolvedValue({ _id: "current", playerTransfersPaused: true }),
    } as never);

    const { requirePlayerTransfersEnabled } = await import("./requirePlayerTransfers");
    const result = await requirePlayerTransfersEnabled({} as never);

    expect(result?.status).toBe(403);
    await expect(result!.json()).resolves.toMatchObject({
      error: "Player-to-player transfers are currently paused by an admin",
    });
  });
});
