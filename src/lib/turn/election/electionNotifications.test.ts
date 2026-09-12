import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendCountryGameEventMultiple, generateDiscordEventCard } = vi.hoisted(() => ({
  sendCountryGameEventMultiple: vi.fn(),
  generateDiscordEventCard: vi.fn(),
}));

vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple,
  DISCORD_COLORS: { electionResult: 0xffd700 },
}));
vi.mock("@/lib/discord/eventCard", () => ({ generateDiscordEventCard }));
vi.mock("@/lib/charts/parliamentChart", () => ({
  getChamberComposition: vi.fn().mockResolvedValue({ seats: [], totalSeats: 0 }),
  generateChamberDiagramSVG: vi.fn().mockReturnValue("<svg />"),
}));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePreset: vi.fn().mockResolvedValue("1953"),
}));

import { sendBatchedElectionResults } from "./electionNotifications";

describe("sendBatchedElectionResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateDiscordEventCard.mockResolvedValue("https://cdn.test/election.png");
  });

  it("sends one compact image embed for a national election", async () => {
    const db = {
      collection: () => ({
        find: () => ({
          toArray: async () => [
            { countryId: "US", sequentialId: 1, name: "Democratic Party" },
            { countryId: "US", sequentialId: 2, name: "Republican Party" },
          ],
        }),
      }),
    };

    await sendBatchedElectionResults(
      db as never,
      [
        {
          electionType: "house",
          state: "CA",
          countryId: "US",
          winnerName: "Jane Doe",
          winnerParty: "1",
          isPlayer: true,
        },
        {
          electionType: "house",
          state: "TX",
          countryId: "US",
          winnerName: "John Doe",
          winnerParty: "2",
          isPlayer: false,
        },
      ],
      new Date("2026-01-01T00:00:00Z")
    );

    expect(generateDiscordEventCard).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "House results",
        detailLines: ["Democratic Party · 1 seat · 1 player", "Republican Party · 1 seat"],
      }),
      "election-us-house"
    );
    expect(sendCountryGameEventMultiple).toHaveBeenCalledWith("US", [
      expect.objectContaining({
        image: { url: "https://cdn.test/election.png" },
      }),
    ]);
  });
});
