import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));

describe("GET /api/discord-bot/tickets/pending-resolutions", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("offers unresolved receipts with and without ticket channels to the bot", async () => {
    const tickets = db.collection("tickets");
    db.collectionMocks.tickets = tickets;
    const projection = vi.fn().mockReturnThis();
    tickets.find.mockReturnValue({
      project: projection,
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://example.com/api/discord-bot/tickets/pending-resolutions")
    );

    expect(response.status).toBe(200);
    expect(tickets.find).toHaveBeenCalledWith({
      status: { $in: ["resolved", "closed"] },
      "resolution.message": { $exists: true },
      "resolution.deliveredAt": null,
      $or: [
        { discordChannelId: { $in: [null, ""] } },
        { "resolution.channelDelivery.status": "posted" },
        { "statusHistory.note": "resolution-channel-delivered" },
        {
          $and: [
            { "statusHistory.note": "discord-ticket-close" },
            { $nor: [{ "statusHistory.note": "resolution-channel-delivered" }] },
          ],
        },
        {
          publicUpdates: {
            $elemMatch: {
              kind: "resolution",
              "delivery.status": { $in: ["failed", "skipped"] },
              "delivery.attempts": { $gte: 5 },
            },
          },
        },
      ],
    });
    expect(projection).toHaveBeenCalledWith(
      expect.objectContaining({
        discordChannelId: 1,
        channelUpdatePosted: expect.objectContaining({ $or: expect.any(Array) }),
      })
    );
  });
});
