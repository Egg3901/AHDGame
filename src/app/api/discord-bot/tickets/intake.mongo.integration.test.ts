import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedIntake } from "@/lib/tickets/intakeState";
let db: Db;
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => db) }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
import { GET, PATCH } from "./route";
import { GET as pendingResolutions } from "./pending-resolutions/route";
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const request = (body: unknown) =>
  new Request("https://example.com/api/discord-bot/tickets", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const reply = (action: string, interactionId: string, value?: string) =>
  PATCH(
    request({
      action: "intake",
      ticketNumber: 42,
      discordChannelId: "channel-42",
      interaction: {
        action,
        interactionId,
        reporterDiscordId: "reporter-42",
        ...(value ? { value } : {}),
      },
    })
  );

describe.skipIf(!uri)("Persistent ticket intake on isolated Mongo", () => {
  let client: MongoClient;
  beforeAll(async () => {
    if (!uri || !["localhost", "127.0.0.1"].includes(new URL(uri).hostname))
      throw new Error("Loopback test Mongo required");
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(`ticket_intake_test_${new ObjectId()}`);
  });
  afterAll(async () => {
    await db?.dropDatabase();
    await client?.close();
  });
  beforeEach(async () => {
    await db.collection("tickets").deleteMany({});
    await db.collection("tickets").insertOne({
      ticketNumber: 42,
      discordChannelId: "channel-42",
      discordUserId: "reporter-42",
      title: "Savings rate",
      description: "Wrong rate on https://ahousedividedgame.com/centralbank/usd",
      status: "in_progress",
      reviewAfter: new Date("2026-01-01"),
      messages: [],
      intake: seedIntake({
        cardMessageId: "card-42",
        candidatePageUrl: "https://ahousedividedgame.com/centralbank/usd",
        platformLabel: "desktop",
      }),
    });
  });
  const ticket = () => db.collection("tickets").findOne({ ticketNumber: 42 });

  it("offers a deleted-channel receipt for DM delivery after the first permanent failure", async () => {
    await db.collection("tickets").updateOne(
      { ticketNumber: 42 },
      {
        $set: {
          status: "resolved",
          resolution: { message: "Issue fixed.", createdAt: new Date(), deliveredAt: null },
          publicUpdates: [
            {
              kind: "resolution",
              delivery: {
                status: "failed",
                attempts: 1,
                error: 'discord 404: {"message":"Unknown Channel","code":10003}',
              },
            },
          ],
        },
      }
    );
    const request = () =>
      new Request("https://example.com/api/discord-bot/tickets/pending-resolutions");
    const response = await (await pendingResolutions(request())).json();
    expect(response.tickets.map((item: { ticketNumber: number }) => item.ticketNumber)).toEqual([
      42,
    ]);
    await db
      .collection("tickets")
      .updateOne(
        { ticketNumber: 42 },
        { $set: { "publicUpdates.0.delivery.error": "discord 503: temporarily unavailable" } }
      );
    expect((await (await pendingResolutions(request())).json()).tickets).toEqual([]);
  });

  it("preserves one receipt version and close event across sequential retries", async () => {
    const body = {
      action: "close",
      ticketNumber: 42,
      discordChannelId: "channel-42",
      closedBy: "staff",
      resolution: "Issue fixed.",
    };
    const first = await (await PATCH(request(body))).json();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const retry = await (await PATCH(request(body))).json();
    expect(retry.resolutionVersion).toBe(first.resolutionVersion);
    expect(retry.finalOutcome).toBe("Issue fixed.");
    expect(
      (await ticket())?.statusHistory.filter(
        (item: { note?: string }) => item.note === "discord-ticket-close"
      )
    ).toHaveLength(1);
  });

  it("acknowledges concurrent close retries with the same stored receipt", async () => {
    const body = {
      action: "close",
      ticketNumber: 42,
      discordChannelId: "channel-42",
      closedBy: "staff",
      resolution: "Merged into ticket #43.",
    };
    const replies = await Promise.all(
      Array.from({ length: 4 }, async () => (await PATCH(request(body))).json())
    );
    expect(new Set(replies.map((reply) => reply.resolutionVersion)).size).toBe(1);
    const saved = await ticket();
    expect(
      saved?.statusHistory.filter((item: { note?: string }) => item.note === "discord-ticket-close")
    ).toHaveLength(1);
    expect(saved?.resolution.createdAt.getTime()).toBe(replies[0].resolutionVersion);
  });

  it("keeps the exact receipt version and channel acknowledgement after delivery", async () => {
    const createdAt = new Date("2026-10-09T10:00:00.123Z");
    await db.collection("tickets").updateOne(
      { ticketNumber: 42 },
      {
        $set: {
          status: "closed",
          resolution: {
            message: "Issue fixed.",
            createdAt,
            deliveredAt: null,
            channelDelivery: { status: "posted", postedAt: createdAt },
          },
        },
      }
    );
    const response = await (
      await PATCH(
        request({
          action: "close",
          ticketNumber: 42,
          discordChannelId: "channel-42",
          resolution: "Issue fixed.",
        })
      )
    ).json();
    expect(response.resolutionVersion).toBe(createdAt.getTime());
    expect(response.channelUpdatePosted).toBe(true);
    expect(response.finalOutcome).toBe("Issue fixed.");
    expect((await ticket())?.statusHistory).toBeUndefined();
  });

  it("persists a decline and waits for correction without blocking the known fix", async () => {
    const [first, retry] = await Promise.all([
      reply("decline_page", "reaction-1"),
      reply("decline_page", "reaction-1"),
    ]);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const saved = await ticket();
    expect(saved?.intake.awaitingReply).toBe("page");
    expect(saved?.intake.pageConfirmed).toBe(false);
    expect(saved?.intake.revision).toBe(1);
    expect(saved?.messages).toHaveLength(1);
    expect(saved?.status).toBe("in_progress");
    expect(saved?.reviewAfter).toEqual(new Date("2026-01-01"));
  });

  it("accepts a correction after the same user message was already mirrored", async () => {
    await reply("decline_page", "reaction-1");
    const message = {
      discordMessageId: "reply-1",
      authorId: "reporter-42",
      content: "https://ahousedividedgame.com/market?tab=stocks",
    };
    expect((await PATCH(request({ action: "append", ticketNumber: 42, message }))).status).toBe(
      200
    );
    expect((await reply("change_page", "reply-1", message.content)).status).toBe(200);
    expect((await reply("change_page", "reply-1", message.content)).status).toBe(200);
    const saved = await ticket();
    expect(saved?.intake.candidatePageUrl).toBe("https://ahousedividedgame.com/market");
    expect(saved?.intake.awaitingReply).toBeNull();
    expect(saved?.intake.pageConfirmed).toBe(true);
    expect(
      saved?.messages.filter((m: { discordMessageId: string }) => m.discordMessageId === "reply-1")
    ).toHaveLength(1);
    expect(saved?.intake.revision).toBe(2);
  });

  it("preserves concurrent page and platform confirmations", async () => {
    await Promise.all([reply("confirm_page", "page-1"), reply("confirm_platform", "platform-1")]);
    const saved = await ticket();
    expect(saved?.intake.pageConfirmed).toBe(true);
    expect(saved?.intake.platformConfirmed).toBe(true);
    expect(saved?.intake.revision).toBe(2);
  });

  it("rejects a different reporter and mismatched channel", async () => {
    expect(
      (
        await PATCH(
          request({
            action: "intake",
            ticketNumber: 42,
            discordChannelId: "channel-42",
            interaction: {
              action: "confirm_page",
              interactionId: "bad-1",
              reporterDiscordId: "someone-else",
            },
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await PATCH(
          request({
            action: "intake",
            ticketNumber: 42,
            discordChannelId: "another-channel",
            intake: { cardMessageId: "another-card" },
          })
        )
      ).status
    ).toBe(404);
    expect((await ticket())?.messages).toHaveLength(0);
  });

  it("restores state after restart and does not expose the recent navigation list", async () => {
    await reply("decline_page", "reaction-1");
    await db.collection("tickets").updateOne(
      { ticketNumber: 42 },
      {
        $set: {
          supportRecentVisits: [
            {
              path: "/unrelated-private-navigation",
              recordedAt: new Date(),
              platform: "desktop",
              device: "desktop",
              gameVersion: "1.13.0",
            },
          ],
        },
      }
    );
    const response = await GET(
      new Request(
        "https://example.com/api/discord-bot/tickets?ticketNumber=42&discordChannelId=channel-42"
      )
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.intake.awaitingReply).toBe("page");
    expect(body.intakeSuggestion.gameVersion).toBe("1.13.0");
    expect(JSON.stringify(body)).not.toContain("unrelated-private-navigation");
    expect(body).not.toHaveProperty("supportRecentVisits");
  });

  it("recovery seeds preserve answers and ordinary message retries deduplicate", async () => {
    await reply("confirm_page", "page-1");
    await PATCH(
      request({
        action: "intake",
        ticketNumber: 42,
        discordChannelId: "channel-42",
        intake: {
          cardMessageId: "recovered-card",
          candidatePageUrl: "https://ahousedividedgame.com/market",
        },
      })
    );
    const message = { discordMessageId: "mirror-1", content: "Still checking" };
    await Promise.all([
      PATCH(request({ action: "append", ticketNumber: 42, message })),
      PATCH(request({ action: "append", ticketNumber: 42, message })),
    ]);
    const saved = await ticket();
    expect(saved?.intake.pageConfirmed).toBe(true);
    expect(saved?.intake.cardMessageId).toBe("recovered-card");
    expect(saved?.intake.candidatePageUrl).toBe("https://ahousedividedgame.com/centralbank/usd");
    expect(
      saved?.messages.filter((m: { discordMessageId: string }) => m.discordMessageId === "mirror-1")
    ).toHaveLength(1);
  });
});
