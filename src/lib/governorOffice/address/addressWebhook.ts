/**
 * National (Head of Government) address Discord embed builder.
 * Pure (no I/O) — call from `deliverAddress` once the national address row is
 * persisted, then pass the returned embed to `sendCountryGameEvent` so it lands
 * in the country's Game Events channel (e.g. a UK PM's Address to the Nation
 * goes to UK Game Events) plus the global game webhook.
 */
import { COUNTRY_CONFIGS, getNationalAddressName, type CountryId } from "@/lib/constants/countries";
import { DISCORD_COLORS, type DiscordEmbed } from "@/lib/discordWebhooks";

// Discord limits: embed title ≤ 256 chars, description ≤ 4096 chars.
const DISCORD_TITLE_MAX = 256;
const DISCORD_DESCRIPTION_MAX = 4096;

export interface NationalAddressEmbedInput {
  countryId: CountryId;
  /** LARP title the leader wrote for the address. */
  title: string;
  /** Optional speech body the leader wrote. */
  body?: string;
  /** Display name of the head of government who delivered the address. */
  deliveredByName: string;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
}

/**
 * Rich embed announcing a head-of-government Address to the Nation. The embed
 * title carries the country's national-address name and the LARP title; the
 * description carries the deliverer/country summary and the full speech body.
 */
export function buildNationalAddressEmbed(input: NationalAddressEmbedInput): DiscordEmbed {
  const { countryId, title, body, deliveredByName } = input;
  const countryName = COUNTRY_CONFIGS[countryId]?.name ?? "the nation";
  const addressName = getNationalAddressName(countryId);

  const trimmedTitle = title.trim();
  const trimmedBody = body?.trim();

  const summary = `${deliveredByName} delivered the ${addressName} to ${countryName}.`;
  const description = trimmedBody ? `${summary}\n\n${trimmedBody}` : summary;

  return {
    title: truncate(`${addressName}: ${trimmedTitle}`, DISCORD_TITLE_MAX),
    description: truncate(description, DISCORD_DESCRIPTION_MAX),
    color: DISCORD_COLORS.nationalAddress,
    footer: { text: "A House Divided" },
    timestamp: new Date().toISOString(),
  };
}
