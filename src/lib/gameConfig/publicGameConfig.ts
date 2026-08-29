import type { GameConfig, PublicGameConfig } from "@/lib/db/types/gameConfig";

/**
 * Strip server-only fields before returning game config from public HTTP handlers.
 */
export function toPublicGameConfig(config: GameConfig): PublicGameConfig {
  const {
    discordGameWebhookUrl: _d1,
    discordCountryGameWebhookUrls: _d2,
    discordNewsWebhookUrl: _d3,
    discordChangelogWebhookUrl: _d4,
    discordSuggestionsWebhookUrl: _d5,
    discordWebhookOwnerService: _d6,
    ...rest
  } = config;
  return rest;
}
