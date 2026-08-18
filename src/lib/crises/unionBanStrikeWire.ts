import {
  DISCORD_COLORS,
  sendCountryGameEvent,
  sendNewsEvent,
  type DiscordEmbed,
} from "@/lib/discordWebhooks";
import { createSystemNewsPost } from "@/lib/news";
import { logWireEvent } from "@/lib/wireEvent";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { struckTradesFor } from "./unionBanStrikeCopy";

/**
 * Press coverage of a wildcat general strike against a union ban.
 *
 * Same plumbing and the same shape as the Vietnam desk: the in-app news feed,
 * the in-game wire and the Discord news channel take the world's story, and the
 * affected country's own channel takes the story written for it. Every URL comes
 * from `gameConfig`; nothing is written down here.
 *
 * The copy is period-neutral on purpose. A union ban can be enacted in 1953 or
 * in 2008, in Washington or in London, so nothing in these headlines can name a
 * decade, a party or a personality.
 */

export const UNION_BAN_STRIKE_WIRE_SOURCE = "Labour Desk";

export interface StrikeHeadline {
  title: string;
  body: string;
}

/** Country display name, falling back to the raw id for unconfigured countries. */
function countryName(countryId: string): string {
  return COUNTRY_CONFIGS[countryId as CountryId]?.name ?? countryId;
}

/** Headlines for the walkout: what the world reads, what the country reads. */
export function strikeStartHeadlines(countryId: string): {
  global: StrikeHeadline;
  national: StrikeHeadline;
} {
  const nation = countryName(countryId);
  const trades = struckTradesFor(countryId);
  return {
    global: {
      title: `General strike shuts down ${nation} after union ban`,
      body: `${nation} has outlawed trade unions, and the unions have stopped work rather than dissolve. The walkout is unofficial and nobody is in a position to call it off: ${trades} are all out, and the freight that ties the rest of the economy together has stopped with them.`,
    },
    national: {
      title: "The country has stopped working",
      body: `The ban on unions took effect and the answer came the same day. Plants are idle, the docks are shut and nothing is moving by road or rail. There is no union office left to negotiate with, which is the government's own doing, so there is nobody to sign an agreement even if one were offered.`,
    },
  };
}

/** How a resolution reads, keyed by the path the executive took. */
const OUTCOME_COPY: Record<string, { global: StrikeHeadline; national: StrikeHeadline }> = {
  troops: {
    global: {
      title: "Troops reopen the plants as the general strike is broken",
      body: "Soldiers are on the gates and the machines are running again. The government has what it wanted and has spent a great deal to get it.",
    },
    national: {
      title: "The strike is over and the army ended it",
      body: "Work resumed under guard. The union ban stands, the pickets are gone, and the people who were on them will remember who sent the troops.",
    },
  },
  settlement: {
    global: {
      title: "Talks end the general strike",
      body: "The government and the strike committees have reached terms and work is restarting. The concessions were real and were paid for out of the treasury.",
    },
    national: {
      title: "A settlement brings people back to work",
      body: "The strike committees have accepted terms and the plants and docks are reopening. It took time and it cost money, and nobody was shot for it.",
    },
  },
  repeal: {
    global: {
      title: "Union ban repealed and the general strike ends",
      body: "The government has withdrawn the ban. The unions are lawful again, their officers are back in their offices, and the strike is over.",
    },
    national: {
      title: "The ban is gone and so is the strike",
      body: "The government backed down. Unions may organise again and every suspended union has been restored with its funds and its officers. Business groups are calling it a surrender.",
    },
  },
};

/** A headline as a Discord embed. Pure, so the copy is testable without a network. */
export function buildStrikeEmbed(headline: StrikeHeadline, countryId: string): DiscordEmbed {
  return {
    title: headline.title,
    description: headline.body,
    color: DISCORD_COLORS.warEscalation,
    fields: [{ name: "Country", value: countryName(countryId), inline: true }],
    footer: { text: UNION_BAN_STRIKE_WIRE_SOURCE },
  };
}

/**
 * Announce the walkout globally and nationally. Fire and forget: every send
 * swallows its own transport failure and the awaits are settled together, so a
 * webhook outage can never wedge a bill enactment.
 */
export async function announceUnionBanStrikeStart(countryId: string): Promise<void> {
  const copy = strikeStartHeadlines(countryId);
  await Promise.allSettled([
    createSystemNewsPost(copy.global.body, "general", { title: copy.global.title }),
    logWireEvent("crisis_start", copy.global.title),
    sendNewsEvent(buildStrikeEmbed(copy.global, countryId)),
    sendCountryGameEvent(countryId, buildStrikeEmbed(copy.national, countryId)),
  ]);
}

/** Announce the end of the strike, framed by the path that ended it. */
export async function announceUnionBanStrikeEnd(countryId: string, outcome: string): Promise<void> {
  const copy = OUTCOME_COPY[outcome];
  if (!copy || !countryId) return;
  await Promise.allSettled([
    createSystemNewsPost(copy.global.body, "general", { title: copy.global.title }),
    logWireEvent("crisis_end", copy.global.title),
    sendNewsEvent(buildStrikeEmbed(copy.global, countryId)),
    sendCountryGameEvent(countryId, buildStrikeEmbed(copy.national, countryId)),
  ]);
}
