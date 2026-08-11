import { describe, expect, it } from "vitest";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { toPublicGameConfig } from "./publicGameConfig";

describe("toPublicGameConfig", () => {
  it("removes Discord webhook URL fields from the public view", () => {
    const full: GameConfig = {
      _id: "default",
      startingFunds: 1,
      startingActions: 1,
      startingFavorability: 0,
      startingInfamy: 0,
      startingPoliticalInfluence: 0,
      startingDonorBaseLevel: 0,
      baseActionsPerTurn: 3,
      turnLengthMinutes: 60,
      officeActionBonus: {},
      chairActionBonus: 3,
      discordGameWebhookUrl: "https://discord.example/game-secret",
      discordCountryGameWebhookUrls: {
        US: "https://discord.example/us-secret",
        JP: "https://discord.example/jp-secret",
      },
      discordNewsWebhookUrl: "https://discord.example/news-secret",
      discordChangelogWebhookUrl: "https://discord.example/changelog-secret",
      discordSuggestionsWebhookUrl: "https://discord.example/suggestions-secret",
    };

    const pub = toPublicGameConfig(full);

    expect(pub).not.toHaveProperty("discordGameWebhookUrl");
    expect(pub).not.toHaveProperty("discordCountryGameWebhookUrls");
    expect(pub).not.toHaveProperty("discordNewsWebhookUrl");
    expect(pub).not.toHaveProperty("discordChangelogWebhookUrl");
    expect(pub).not.toHaveProperty("discordSuggestionsWebhookUrl");
    expect(pub.baseActionsPerTurn).toBe(3);
    expect(pub._id).toBe("default");
  });
});
