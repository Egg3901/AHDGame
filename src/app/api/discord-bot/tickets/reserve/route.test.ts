import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/requireBotToken", () => ({ requireBotToken: vi.fn(() => true) }));
vi.mock("@/lib/ticketCounter", () => ({ getNextTicketNumber: vi.fn(() => Promise.resolve(1439)) }));

describe("POST /api/discord-bot/tickets/reserve", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the shared atomic sequence after incorporating the Discord floor", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.com/api/discord-bot/tickets/reserve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordFloor: 1438 }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ticketNumber: 1439 });
    const { getNextTicketNumber } = await import("@/lib/ticketCounter");
    expect(getNextTicketNumber).toHaveBeenCalledWith(1438);
  });

  it("rejects an invalid floor and requires the private bot token", async () => {
    const { POST } = await import("./route");
    const invalid = await POST(
      new Request("https://example.com/api/discord-bot/tickets/reserve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordFloor: -1 }),
      })
    );
    expect(invalid.status).toBe(400);

    const { requireBotToken } = await import("@/lib/api/requireBotToken");
    vi.mocked(requireBotToken).mockReturnValueOnce(false);
    const unauthorized = await POST(
      new Request("https://example.com/api/discord-bot/tickets/reserve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordFloor: 0 }),
      })
    );
    expect(unauthorized.status).toBe(401);
  });
});
