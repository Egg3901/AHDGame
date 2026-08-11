/**
 * Central Bank prime rate change Discord embed builder.
 * Pure (no I/O) — call from the rate-change route after the DB write succeeds,
 * then pass the returned embed to sendCountryGameEvent.
 */
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DISCORD_COLORS, type DiscordEmbed } from "@/lib/discordWebhooks";
import { centralBankUrl } from "@/lib/urls";

export interface PrimeRateChangeInput {
  countryId: CountryId;
  previousRate: number;
  newRate: number;
  /** Display name of the actor — already includes "(admin)" suffix when an admin overrides. */
  changedByName: string;
  reason?: string;
  /** When true, the cut exceeded the normal threshold and +10 scrutiny was applied to the chair. */
  scrutinyApplied?: boolean;
}

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

export function buildPrimeRateChangeEmbed(input: PrimeRateChangeInput): DiscordEmbed {
  const { countryId, previousRate, newRate, changedByName, reason, scrutinyApplied } = input;

  // Caller (route) rejects equal-rate requests with HTTP 400 before this runs.
  // Treat equality as a programmer error rather than rendering an ambiguous embed.
  if (previousRate === newRate) {
    throw new Error("buildPrimeRateChangeEmbed: previousRate and newRate must differ");
  }

  const isHike = newRate > previousRate;
  const bankName = COUNTRY_CONFIGS[countryId].centralBank.name;
  const verbTitle = isHike ? "Rate Hike" : "Rate Cut";
  const verbDescription = isHike ? "raised" : "lowered";
  const color = isHike ? DISCORD_COLORS.primeRateHike : DISCORD_COLORS.primeRateCut;

  // Basis points: 1% = 100 bps. Round to nearest integer to absorb float noise.
  const bpsDelta = Math.round((newRate - previousRate) * 100);
  const signedBps = `${bpsDelta > 0 ? "+" : ""}${bpsDelta} bps`;

  const url = `${BASE_URL}${centralBankUrl(countryId)}`;

  const fields: NonNullable<DiscordEmbed["fields"]> = [
    { name: "Chair", value: changedByName, inline: true },
    { name: "Change", value: signedBps, inline: true },
    { name: "View", value: `[Open Central Bank](${url})`, inline: true },
  ];

  if (reason) {
    fields.push({ name: "Reason", value: reason });
  }

  if (scrutinyApplied) {
    fields.push({ name: "Scrutiny", value: "+10 scrutiny applied (aggressive cut)" });
  }

  return {
    title: `${bankName} — ${verbTitle}`,
    description: `Prime rate ${verbDescription} from ${previousRate.toFixed(2)}% to ${newRate.toFixed(2)}% (${signedBps}).`,
    color,
    fields,
    url,
    footer: { text: "A House Divided" },
    timestamp: new Date().toISOString(),
  };
}
