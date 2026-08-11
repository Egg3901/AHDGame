/**
 * Discord game-event embeds for the independence/reunification referendum
 * process. Each step posts to the relevant country's Game Events webhook:
 *   - FM request, PM grant/decline, public vote, Commons consent → UK
 *   - Dáil consent                                               → IE
 *   - reunification complete                                     → UK + IE
 *   - secession complete                                         → UK + new nation
 *
 * Builders are pure (return a `DiscordEmbed`); the `announce*` wrappers resolve
 * the target webhook and send fire-and-forget (the send helpers swallow errors).
 * Server-only — imports the MongoDB-backed webhook dispatch.
 */
import type { DiscordEmbed } from "@/lib/discordWebhooks";
import {
  DISCORD_COLORS,
  sendCountryGameEvent,
  sendMultiCountryGameEvent,
} from "@/lib/discordWebhooks";
import type { Referendum, ReferendumKind } from "@/lib/db/types/referendum";
import type { CountryId } from "@/lib/constants/countries";

const REGION_NAMES: Record<string, string> = {
  SCO: "Scotland",
  WAL: "Wales",
  NIR: "Northern Ireland",
};

/** Celebratory green for a completed reunification. */
const REUNIFICATION_COLOR = 0x169b62;
/** Celebratory accent for a newly-independent nation (saltire blue / Welsh red). */
const INDEPENDENCE_COLORS: Record<string, number> = { SCO: 0x005eb8, WAL: 0xc8102e };
const INDEPENDENCE_COLOR_FALLBACK = 0x1b9e77;
const FOOTER = { text: "A House Divided" } as const;

function regionName(regionId: string): string {
  return REGION_NAMES[regionId.toUpperCase()] ?? regionId;
}

function noun(kind: ReferendumKind): string {
  return kind === "reunification" ? "reunification" : "independence";
}

function Noun(kind: ReferendumKind): string {
  return kind === "reunification" ? "Reunification" : "Independence";
}

// ── Pure embed builders ───────────────────────────────────────────────────────

export function buildReferendumRequestedEmbed(args: {
  region: string;
  kind: ReferendumKind;
}): DiscordEmbed {
  return {
    title: `${args.region}: ${Noun(args.kind)} Referendum Requested`,
    description:
      `The First Minister of ${args.region} has formally petitioned for a ${noun(args.kind)} ` +
      `referendum. It now awaits the Prime Minister's decision to grant or decline.`,
    color: DISCORD_COLORS.electionOpen,
    footer: FOOTER,
  };
}

export function buildReferendumDecisionEmbed(args: {
  region: string;
  kind: ReferendumKind;
  action: "grant" | "decline";
}): DiscordEmbed {
  if (args.action === "grant") {
    return {
      title: `${args.region}: Referendum Granted`,
      description:
        `The Prime Minister has **granted** ${args.region}'s ${noun(args.kind)} referendum. ` +
        `A public campaign now opens ahead of the ballot.`,
      color: DISCORD_COLORS.billEnacted,
      footer: FOOTER,
    };
  }
  return {
    title: `${args.region}: Referendum Declined`,
    description: `The Prime Minister has **declined** ${args.region}'s ${noun(args.kind)} referendum.`,
    color: DISCORD_COLORS.govCollapsed,
    footer: FOOTER,
  };
}

export function buildReferendumVoteResultEmbed(args: {
  region: string;
  kind: ReferendumKind;
  passed: boolean;
  finalYesShare: number;
}): DiscordEmbed {
  const yes = Math.round(args.finalYesShare);
  if (args.passed) {
    const title =
      args.kind === "reunification"
        ? `${args.region} Votes to Rejoin Ireland`
        : `${args.region} Votes for Independence`;
    const tail =
      args.kind === "reunification"
        ? ` Westminster and the Dáil must now both consent for the union to take effect.`
        : ` Westminster must now consent for independence to take effect.`;
    return {
      title,
      description: `${args.region} has voted **Yes** in its ${noun(args.kind)} referendum (${yes}% Yes).${tail}`,
      color: DISCORD_COLORS.electionResult,
      footer: FOOTER,
    };
  }
  return {
    title: `${args.region} Rejects ${Noun(args.kind)}`,
    description:
      `${args.region} has voted **No** in its ${noun(args.kind)} referendum (${yes}% Yes). ` +
      `The question is settled for now.`,
    color: DISCORD_COLORS.govCollapsed,
    footer: FOOTER,
  };
}

export function buildConsentBillEmbed(args: {
  chamber: "commons" | "dail";
  passed: boolean;
}): DiscordEmbed {
  if (args.chamber === "commons") {
    return args.passed
      ? {
          title: "Westminster Consents: Northern Ireland (Reunification) Bill Passes",
          description:
            "The House of Commons has **passed** the bill to release Northern Ireland. The Dáil " +
            "must also pass its bill for reunification to take effect.",
          color: DISCORD_COLORS.billEnacted,
          footer: FOOTER,
        }
      : {
          title: "Westminster Rejects the Northern Ireland (Reunification) Bill",
          description:
            "The House of Commons has **rejected** the bill to release Northern Ireland. " +
            "Reunification cannot proceed.",
          color: DISCORD_COLORS.billVetoed,
          footer: FOOTER,
        };
  }
  return args.passed
    ? {
        title: "The Dáil Consents: Reunification Bill Passes",
        description:
          "Dáil Éireann has **passed** the bill to admit Northern Ireland. Westminster must also " +
          "pass its bill for reunification to take effect.",
        color: DISCORD_COLORS.billEnacted,
        footer: FOOTER,
      }
    : {
        title: "The Dáil Rejects the Reunification Bill",
        description:
          "Dáil Éireann has **rejected** the bill to admit Northern Ireland. Reunification " +
          "cannot proceed.",
        color: DISCORD_COLORS.billVetoed,
        footer: FOOTER,
      };
}

export function buildReunificationCompleteEmbed(args: { region: string }): DiscordEmbed {
  return {
    title: `${args.region} Rejoins Ireland`,
    description:
      `It is done — ${args.region} has formally left the United Kingdom and reunified with the ` +
      `Republic of Ireland. Its constituencies now return members to the Dáil.`,
    color: REUNIFICATION_COLOR,
    footer: FOOTER,
  };
}

/** Westminster's vote on a single independence consent bill (the UK releasing
 *  the region as a sovereign country). There is no counterpart parliament. */
export function buildIndependenceConsentBillEmbed(args: {
  region: string;
  passed: boolean;
}): DiscordEmbed {
  return args.passed
    ? {
        title: `Westminster Consents: ${args.region} (Independence) Bill Passes`,
        description:
          `The House of Commons has **passed** the bill to release ${args.region} as an ` +
          `independent sovereign country. Independence will now take effect.`,
        color: DISCORD_COLORS.billEnacted,
        footer: FOOTER,
      }
    : {
        title: `Westminster Rejects the ${args.region} (Independence) Bill`,
        description:
          `The House of Commons has **rejected** the bill to release ${args.region}. ` +
          `Independence cannot proceed.`,
        color: DISCORD_COLORS.billVetoed,
        footer: FOOTER,
      };
}

export function buildSecessionCompleteEmbed(args: {
  region: string;
  regionId: string;
}): DiscordEmbed {
  return {
    title: `${args.region} Becomes Independent`,
    description:
      `It is done — ${args.region} has formally left the United Kingdom to become a sovereign ` +
      `nation, with its own parliament and government.`,
    color: INDEPENDENCE_COLORS[args.regionId.toUpperCase()] ?? INDEPENDENCE_COLOR_FALLBACK,
    footer: FOOTER,
  };
}

// ── Announce wrappers (resolve target webhook + send) ──────────────────────────

/**
 * Post a process embed to every country party to the referendum. A reunification
 * (NIR) concerns both the releasing country (UK) and the admitting one (IE), so
 * those steps cross-post to both Game Events webhooks; an independence (SCO/WAL)
 * is a UK-only affair and posts to the UK webhook only.
 */
async function announceToProcessCountries(ref: Referendum, embed: DiscordEmbed): Promise<void> {
  if (ref.kind === "reunification" && ref.targetCountryId) {
    await sendMultiCountryGameEvent([ref.countryId, ref.targetCountryId], embed);
    return;
  }
  await sendCountryGameEvent(ref.countryId, embed);
}

export async function announceReferendumRequested(ref: Referendum): Promise<void> {
  await announceToProcessCountries(
    ref,
    buildReferendumRequestedEmbed({ region: regionName(ref.regionId), kind: ref.kind })
  );
}

export async function announceReferendumDecision(
  ref: Referendum,
  action: "grant" | "decline"
): Promise<void> {
  await announceToProcessCountries(
    ref,
    buildReferendumDecisionEmbed({ region: regionName(ref.regionId), kind: ref.kind, action })
  );
}

export async function announceReferendumVoteResult(
  ref: Referendum,
  args: { passed: boolean; finalYesShare: number }
): Promise<void> {
  await announceToProcessCountries(
    ref,
    buildReferendumVoteResultEmbed({
      region: regionName(ref.regionId),
      kind: ref.kind,
      passed: args.passed,
      finalYesShare: args.finalYesShare,
    })
  );
}

export async function announceConsentBillResolved(
  ref: Referendum,
  chamber: "commons" | "dail",
  passed: boolean
): Promise<void> {
  // Commons → UK webhook; Dáil → the admitting country (IE).
  const targetCountry = chamber === "commons" ? ref.countryId : (ref.targetCountryId ?? "IE");
  // Independence has only the single Westminster (Commons) bill, with its own
  // "release as a sovereign country" wording; reunification uses the NI bills.
  const embed =
    ref.kind === "independence"
      ? buildIndependenceConsentBillEmbed({ region: regionName(ref.regionId), passed })
      : buildConsentBillEmbed({ chamber, passed });
  await sendCountryGameEvent(targetCountry, embed);
}

export async function announceReunificationComplete(ref: Referendum): Promise<void> {
  await sendMultiCountryGameEvent(
    [ref.countryId, ref.targetCountryId ?? "IE"],
    buildReunificationCompleteEmbed({ region: regionName(ref.regionId) })
  );
}

export async function announceSecessionComplete(ref: Referendum): Promise<void> {
  // Cross-post to the releasing country (UK) and the new nation's own Game
  // Events webhook (if it has one) — mirroring the reunification cross-post.
  await sendMultiCountryGameEvent(
    [ref.countryId, ref.regionId as CountryId],
    buildSecessionCompleteEmbed({ region: regionName(ref.regionId), regionId: ref.regionId })
  );
}
