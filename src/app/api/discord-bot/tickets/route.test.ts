import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
vi.mock("@/lib/ticketCounter", () => ({ getNextTicketNumber: vi.fn(() => Promise.resolve(1001)) }));

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
      expect.objectContaining({ discordChannelId: "discord-channel-1" }),
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
      expect.objectContaining({ discordChannelId: "discord-channel-1" }),
      expect.objectContaining({
        $set: expect.objectContaining({ "resolution.deliveredAt": null }),
      })
    );
    expect(db.collectionMocks.tickets.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ discordChannelId: "discord-channel-1" }),
      expect.objectContaining({
        projection: expect.objectContaining({ "statusHistory.at": 1 }),
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
    expect(db.collectionMocks.tickets.updateOne).not.toHaveBeenCalled();
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
      expect.objectContaining({ discordChannelId: "discord-channel-1" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          "resolution.message": "The corrected fix is live.",
        }),
      })
    );
  });

  it("preserves a matching legacy channel receipt marker", async () => {
    const createdAt = new Date("2026-09-22T10:00:00.000Z");
    db.collectionMocks.tickets.findOne.mockResolvedValueOnce({
      status: "closed",
      discordChannelId: "discord-channel-1",
      resolution: {
        message: "The fix is live.",
        createdAt,
        deliveredAt: null,
      },
      statusHistory: [
        {
          note: "resolution-channel-delivered",
          at: new Date("2026-09-22T10:05:00.000Z"),
        },
      ],
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
          resolution: "Do not replace the channel-visible outcome.",
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      channelUpdatePosted: true,
      finalOutcome: "The fix is live.",
    });
    expect(db.collectionMocks.tickets.updateOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/discord-bot/tickets filing context", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("tickets");
    db.collection("users");
    db.collection("characters");
    db.collection("corporations");
  });

  function post(body: Record<string, unknown>) {
    return new Request("https://example.com/api/discord-bot/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns context questions and persists a versioned request for an unlinked reporter", async () => {
    const { POST } = await import("./route");
    const { creationContextKey } = await import("@/lib/tickets/contextNeeds");
    const response = await POST(
      post({
        category: "bug",
        title: "Market page broken",
        description: "The market screen does not load.",
        discordUserId: "ctx-test-unlinked-1",
      })
    );

    expect(response.status).toBe(200);
    const created = (await response.json()) as {
      ticketNumber: number;
      contextNeeded: string[];
      contextKey: string | null;
      contextQuestions: string[];
    };
    expect(created.ticketNumber).toBe(1001);
    expect(created.contextNeeded).toEqual(["discord", "page"]);
    expect(created.contextKey).toBe(creationContextKey(["discord", "page"]));
    expect(created.contextQuestions).toHaveLength(3);
    expect(created.contextQuestions[2]).toContain("confirm your platform");
    expect(db.collectionMocks.tickets.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        contextRequest: expect.objectContaining({
          version: 1,
          needed: ["discord", "page"],
          generatedBy: "creation-deterministic",
        }),
      })
    );
  });

  it("returns no needs for a linked reporter whose corporation resolved", async () => {
    db.collectionMocks.users.findOne.mockResolvedValue({ _id: "user-1", username: "tester" });
    db.collectionMocks.characters.findOne.mockResolvedValue({ name: "Hero", sequentialId: 5 });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      name: "Acme",
      tickerSymbol: "ACME",
      sequentialId: 9,
    });
    const { POST } = await import("./route");
    const response = await POST(
      post({
        category: "gameplay",
        title: "Question about elections",
        description: "How do elections work?",
        discordUserId: "ctx-test-linked-1",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      contextNeeded: [],
      contextKey: null,
      contextQuestions: [expect.stringContaining("confirm your platform")],
    });
  });

  it("logs recent linked visits privately and asks to confirm the likely page", async () => {
    const recent = new Date();
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: "user-1",
      username: "tester",
      supportRecentVisits: [
        {
          path: "/corporation/9?token=secret",
          recordedAt: recent,
          platform: "desktop",
          device: "desktop",
          gameVersion: "1.2.3",
        },
        {
          path: "/market",
          recordedAt: recent,
          platform: "android",
          device: "mobile",
          gameVersion: "1.2.3",
          clientVersion: "1.4.2",
        },
      ],
    });
    const { POST } = await import("./route");
    const response = await POST(
      post({
        category: "bug",
        title: "Market button missing",
        description: "Market does not load",
        discordUserId: "ctx-linked-history",
      })
    );
    const result = await response.json();
    expect(result.contextQuestions.join("\n")).toContain("https://ahousedividedgame.com/market>");
    // The suggested page answers the page need; the player confirms it in one tap.
    expect(result.contextNeeded).toEqual([]);
    expect(result).not.toHaveProperty("supportRecentVisits");
    const stored = db.collectionMocks.tickets.insertOne.mock.calls[0][0];
    expect(stored.supportRecentVisits).toHaveLength(2);
    expect(JSON.stringify(stored.supportRecentVisits)).not.toContain("token");
  });

  it("does not ask for a page because of the bot's platform line (ticket 1448)", async () => {
    db.collectionMocks.users.findOne.mockResolvedValue({ _id: "user-1", username: "tester" });
    const { POST } = await import("./route");
    const response = await POST(
      post({
        category: "bug",
        title: "Profit Margin Calculations don't make sense to me",
        description:
          "Platform: Desktop: web browser\n\nProfit Margin Calculations don't make sense to me",
        discordUserId: "ctx-platform-prefix",
      })
    );
    const result = (await response.json()) as { contextNeeded: string[] };
    expect(result.contextNeeded).toEqual([]);
  });

  it("still requires the bot token", async () => {
    const { requireBotToken } = await import("@/lib/api/requireBotToken");
    vi.mocked(requireBotToken).mockReturnValueOnce(false);
    const { POST } = await import("./route");
    const response = await POST(
      post({ category: "bug", title: "x", description: "y", discordUserId: "ctx-test-auth-1" })
    );
    expect(response.status).toBe(401);
  });

  it("still rejects invalid bodies with Zod", async () => {
    const { POST } = await import("./route");
    const response = await POST(post({ category: "bug", description: "missing title" }));
    expect(response.status).toBe(400);
  });

  it("refuses to bind a ticket number already owned by another Discord channel", async () => {
    const { ObjectId } = await import("mongodb");
    db.collectionMocks.tickets.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      ticketNumber: 1435,
      discordChannelId: "original-channel",
    });
    const { POST } = await import("./route");
    const response = await POST(
      post({
        category: "bug",
        title: "Another report",
        description: "A separate channel must not take this ticket number.",
        ticketNumber: 1435,
        discordChannelId: "duplicate-channel",
      })
    );

    expect(response.status).toBe(409);
    expect(db.collectionMocks.tickets.insertOne).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/discord-bot/tickets merge", () => {
  let db: MockDb;
  const tickets: Record<number, Record<string, unknown>> = {};

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("tickets");
    for (const k of Object.keys(tickets)) delete tickets[Number(k)];
    tickets[1539] = { ticketNumber: 1539, status: "open", category: "incident" };
    tickets[1540] = { ticketNumber: 1540, status: "open", category: "bug", discordUserId: "777" };
    db.collectionMocks.tickets.findOne.mockImplementation(
      async (filter: { ticketNumber?: number }) => {
        const t = filter.ticketNumber != null ? tickets[filter.ticketNumber] : undefined;
        return t ? { ...t } : null;
      }
    );
    db.collectionMocks.tickets.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  const merge = async (body: Record<string, unknown>) => {
    const { PATCH } = await import("./route");
    return PATCH(
      new Request("https://example.com/api/discord-bot/tickets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "merge", ...body }),
      })
    );
  };

  it("closes the repeat ticket and records it on the incident once", async () => {
    const res = await merge({
      ticketNumber: 1540,
      targetTicketNumber: 1539,
      mergedBy: "333",
      reason: "same outage",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(
      expect.objectContaining({ ok: true, targetTicketNumber: 1539, targetCategory: "incident" })
    );
    const calls = db.collectionMocks.tickets.updateOne.mock.calls;
    expect(calls[0][0]).toEqual({
      ticketNumber: 1539,
      "mergedTickets.ticketNumber": { $ne: 1540 },
    });
    expect(calls[0][1].$push.mergedTickets).toEqual(
      expect.objectContaining({ ticketNumber: 1540, discordUserId: "777", mergedBy: "333" })
    );
    expect(calls[1][0]).toEqual({
      ticketNumber: 1540,
      $or: [{ mergedInto: { $exists: false } }, { mergedInto: 1539 }],
    });
    expect(calls[1][1].$set).toEqual(
      expect.objectContaining({
        status: "closed",
        mergedInto: 1539,
        mergedBy: "333",
        closedBy: "333",
      })
    );
    expect(calls[1][1].$push.statusHistory.note).toBe("merged into #1539: same outage");
  });

  it("is idempotent once the merge is recorded", async () => {
    tickets[1540] = { ...tickets[1540], status: "closed", mergedInto: 1539 };
    const res = await merge({ ticketNumber: 1540, targetTicketNumber: 1539 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ alreadyMerged: true }));
    expect(db.collectionMocks.tickets.updateOne).toHaveBeenCalledTimes(1);
  });

  it("refuses self merges, closed targets, missing tickets and a second target", async () => {
    expect((await merge({ ticketNumber: 1539, targetTicketNumber: 1539 })).status).toBe(400);
    tickets[1539].status = "closed";
    expect((await merge({ ticketNumber: 1540, targetTicketNumber: 1539 })).status).toBe(409);
    expect((await merge({ ticketNumber: 1540, targetTicketNumber: 9999 })).status).toBe(404);
    expect((await merge({ ticketNumber: 4242, targetTicketNumber: 1539 })).status).toBe(404);
    tickets[1539].status = "open";
    tickets[1540] = { ...tickets[1540], mergedInto: 1500 };
    expect((await merge({ ticketNumber: 1540, targetTicketNumber: 1539 })).status).toBe(409);
    expect(db.collectionMocks.tickets.updateOne).not.toHaveBeenCalled();
  });

  it("accepts the incident category on create", async () => {
    const { POST } = await import("./route");
    db.collectionMocks.tickets.insertOne.mockResolvedValue({ insertedId: "x" });
    const res = await POST(
      new Request("https://example.com/api/discord-bot/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "incident",
          title: "Turn processing stalled",
          description: "Turn 180 has not processed for 40 minutes.",
        }),
      })
    );
    expect(res.status).toBeLessThan(300);
  });
});
