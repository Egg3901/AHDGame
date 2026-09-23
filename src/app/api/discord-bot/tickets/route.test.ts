import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));

describe("PATCH /api/discord-bot/tickets", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("tickets");
    db.collectionMocks.tickets.findOne.mockResolvedValue({
      status: "resolved",
      resolution: {},
      statusHistory: [],
    });
  });

  it("records the channel receipt independently from the reporter DM", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("https://example.com/api/discord-bot/tickets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "resolution-channel-delivered",
          ticketNumber: 42,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledWith(
      {
        ticketNumber: 42,
        "statusHistory.note": { $ne: "resolution-channel-delivered" },
      },
      expect.objectContaining({
        $push: {
          statusHistory: expect.objectContaining({
            status: "resolved",
            source: "bot",
            note: "resolution-channel-delivered",
          }),
        },
      })
    );
  });

  it("accepts the channel identifier used by the bot close flow", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("https://example.com/api/discord-bot/tickets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "close",
          discordChannelId: "discord-channel-1",
          closedBy: "staff-user",
          resolution: "Fix deployed; receipt linked.",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledWith(
      { discordChannelId: "discord-channel-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "closed",
          "resolution.message": "Fix deployed; receipt linked.",
        }),
      })
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      alreadyClosed: false,
      channelUpdatePosted: false,
      resolutionDelivered: false,
      finalOutcome: "Fix deployed; receipt linked.",
    });
  });

  it("preserves channel and DM delivery markers when a close is retried", async () => {
    db.collectionMocks.tickets.findOne.mockResolvedValueOnce({
      status: "closed",
      resolution: {
        deliveredAt: new Date("2026-09-22T10:00:00.000Z"),
        channelDelivery: { status: "posted" },
      },
      statusHistory: [],
    });
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("https://example.com/api/discord-bot/tickets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "close",
          discordChannelId: "discord-channel-1",
          closedBy: "staff-user",
          resolution: "A new resolution must not overwrite an already delivered one.",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledWith(
      { discordChannelId: "discord-channel-1" },
      expect.objectContaining({
        $set: expect.not.objectContaining({ "resolution.message": expect.anything() }),
      })
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      alreadyClosed: true,
      channelUpdatePosted: true,
      resolutionDelivered: true,
    });
  });
});
