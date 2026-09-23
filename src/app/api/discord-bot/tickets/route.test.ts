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
        "statusHistory.note": {
          $ne: "discord-ticket-channel-delivered:legacy",
        },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          "resolution.channelDelivery.status": "posted",
          "resolution.channelDelivery.postedAt": expect.any(Date),
        }),
        $push: {
          statusHistory: expect.objectContaining({
            status: "resolved",
            source: "bot",
            note: "discord-ticket-channel-delivered:legacy",
          }),
        },
      })
    );
  });

  it("records an explicit DM delivery marker", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("https://example.com/api/discord-bot/tickets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolution-dm-delivered", ticketNumber: 42 }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledWith(
      {
        ticketNumber: 42,
        "statusHistory.note": { $ne: "discord-ticket-dm-delivered:legacy" },
      },
      expect.objectContaining({
        $set: expect.objectContaining({ "resolution.deliveredAt": expect.any(Date) }),
        $push: {
          statusHistory: expect.objectContaining({
            status: "resolved",
            source: "bot",
            note: "discord-ticket-dm-delivered:legacy",
          }),
        },
      })
    );
  });

  it("starts a new resolution delivery version when a ticket is retriaged", async () => {
    db.collectionMocks.tickets.findOne.mockResolvedValueOnce({
      resolution: {
        message: "The old resolution.",
        createdAt: new Date("2026-09-22T10:00:00.000Z"),
        deliveredAt: new Date("2026-09-22T10:00:00.000Z"),
        channelDelivery: { status: "posted" },
      },
    });
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("https://example.com/api/discord-bot/tickets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retriage", ticketNumber: 42 }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledWith(
      { ticketNumber: 42 },
      expect.objectContaining({
        $set: expect.objectContaining({
          "resolution.createdAt": expect.any(Date),
          "resolution.deliveredAt": null,
        }),
        $unset: expect.objectContaining({ "resolution.channelDelivery": "" }),
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
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      alreadyClosed: false,
      channelUpdatePosted: false,
      resolutionDelivered: false,
      resolutionVersion: expect.any(Number),
      finalOutcome: "Fix deployed; receipt linked.",
    });
  });

  it("does not treat an old channel post timestamp as a delivered DM", async () => {
    db.collectionMocks.tickets.findOne.mockResolvedValueOnce({
      status: "closed",
      discordChannelId: "discord-channel-1",
      resolution: {
        message: "The fix is live.",
        createdAt: new Date("2026-09-22T10:00:00.000Z"),
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
        $set: expect.objectContaining({ "resolution.deliveredAt": null }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      alreadyClosed: true,
      channelUpdatePosted: true,
      resolutionDelivered: false,
      resolutionVersion: new Date("2026-09-22T10:00:00.000Z").getTime(),
      finalOutcome: "The fix is live.",
    });
  });

  it("preserves a DM confirmed by the explicit DM marker", async () => {
    const createdAt = new Date("2026-09-22T10:00:00.000Z");
    db.collectionMocks.tickets.findOne.mockResolvedValueOnce({
      status: "closed",
      discordChannelId: "discord-channel-1",
      resolution: {
        message: "The fix is live.",
        createdAt,
        deliveredAt: createdAt,
        channelDelivery: { status: "posted" },
      },
      statusHistory: [{ note: `discord-ticket-dm-delivered:${createdAt.getTime()}` }],
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
          resolution: "An already sent final outcome must not be resent.",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledWith(
      { discordChannelId: "discord-channel-1" },
      expect.objectContaining({
        $set: expect.not.objectContaining({
          "resolution.message": expect.anything(),
          "resolution.deliveredAt": null,
        }),
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      alreadyClosed: true,
      channelUpdatePosted: true,
      resolutionDelivered: true,
      resolutionVersion: createdAt.getTime(),
      finalOutcome: "The fix is live.",
    });
  });

  it("does not reuse a channel receipt from an older resolution", async () => {
    const oldResolutionAt = new Date("2026-09-22T10:00:00.000Z");
    const newResolutionAt = new Date("2026-09-23T10:00:00.000Z");
    db.collectionMocks.tickets.findOne.mockResolvedValueOnce({
      status: "closed",
      discordChannelId: "discord-channel-1",
      resolution: {
        message: "The earlier fix is live.",
        createdAt: newResolutionAt,
        deliveredAt: null,
        channelDelivery: { status: "posted", postedAt: oldResolutionAt },
      },
      statusHistory: [{ note: "resolution-channel-delivered", at: oldResolutionAt }],
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
          resolution: "The corrected fix is live.",
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      alreadyClosed: true,
      channelUpdatePosted: false,
      resolutionDelivered: false,
      resolutionVersion: expect.any(Number),
      finalOutcome: "The corrected fix is live.",
    });
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledWith(
      { discordChannelId: "discord-channel-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "resolution.message": "The corrected fix is live.",
        }),
      })
    );
  });
});
