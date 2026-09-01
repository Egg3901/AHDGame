/**
 * A settled war's dispatch to World News.
 *
 * WHAT IS AND IS NOT NEWS. Offers, withdrawals and rejections are private business
 * between two governments and stay off the wire entirely: a channel carrying every
 * probe would bury the one post that matters. What gets a post is the ENDING, and
 * the term that was taken with it. A white peace posts too, because a war ending
 * with nobody paying anything is news about the world as much as a reparation is.
 *
 * PURE BUILDERS. Every function here takes a document and returns copy. The database
 * writes and the stamping live in `emitWarWire`, which keeps the copy testable
 * without a database and the stamping testable without asserting on prose. Same
 * split the settlement crisis uses, for the same reason.
 *
 * HOUSE STYLE, inherited from the Bonn Desk dispatches: a short narrative title that
 * says what happened rather than naming the feature, two sentences of prose carrying
 * no digits, then terse labelled fields for the figures, under a named desk in the
 * footer rather than the product name.
 *
 * Copy rules this file follows, all project-wide: no em or en dashes; no calendar
 * years and no "current rate" phrasing, because the same text has to read correctly
 * in every era; and no anchor units, because those are not a player-facing currency.
 * An indemnity's figure is printed beside the country that paid it, in that
 * country's own money.
 */
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { governmentSystemLabel, type PeaceTerm } from "@/lib/military/peaceTerm";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DISCORD_COLORS, type DiscordEmbed } from "@/lib/discordWebhooks";

/** The byline every war dispatch carries. */
const DESK = "War Desk";

/** The one moment a war gets a post. Kept as a union so more can be added later. */
export type WarWireEvent = "settled";

export interface WarDispatch {
  title: string;
  /** Plain body, for the in-game news feed. */
  body: string;
  embed: DiscordEmbed;
}

const name = (id: string): string => COUNTRY_CONFIGS[id as CountryId]?.name ?? id;

/**
 * A headline that says what happened, not what the feature is called.
 *
 * A post titled "Peace terms imposed" reads as a status widget and gets skimmed
 * past; one that names the country and the consequence reads as a sentence about
 * the world.
 */
function settledTitle(conflict: ConflictDoc): string {
  const term = conflict.settlement?.term;
  const loser = conflict.settlement?.target;
  if (!term || !loser) return `${conflict.name} is over`;

  if (term.kind === "white_peace") return `${conflict.name} ends where it began`;
  if (term.kind === "regime_change") return `${name(loser)} is made to change its government`;
  if (term.kind === "demilitarisation") return `${name(loser)} is disarmed by treaty`;
  if (term.kind === "reunification") return "Germany is made one";
  if (term.amount > 0) return `${name(loser)} pays for the peace`;
  return `${conflict.name} ends with nothing taken`;
}

/** Prose carrying no digits: the figures live in the fields, where they can be read. */
function settledBody(conflict: ConflictDoc, rulingPartyName?: string | null): string {
  const s = conflict.settlement;
  if (!s) {
    return (
      `${conflict.name} is over. The fighting stopped at the front line and neither ` +
      "government took anything from the other for it."
    );
  }

  const winner = name(s.imposedBy);
  const loser = name(s.target);
  const how =
    s.path === "dictated"
      ? "was in no position to refuse"
      : "agreed to the terms rather than fight on";

  if (s.term.kind === "white_peace") {
    return (
      `${conflict.name} is over on the terms it started with. Neither government ` +
      "prevailed, no border moved, and whatever the war was meant to settle is still " +
      "there to be argued over."
    );
  }
  if (s.term.kind === "regime_change") {
    // A one-party conversion is not "going to the polls" in any sense a reader
    // would recognise, and where the victor NAMED the party it is the whole
    // substance of the settlement. Reporting it as a generic change of system
    // would leave the dispatch describing something milder than what happened.
    if (s.term.targetSystem === "onePartyState") {
      // No name means the settlement named no party and the strongest bench took
      // power on its own. Saying so is more honest than implying a choice the
      // victor did not make.
      const ruler = rulingPartyName ? `under the ${rulingPartyName}` : "under its strongest party";
      return (
        `${conflict.name} is over, and ${loser} ${how}. Its government falls with the ` +
        `war and it is reconstituted as a one-party state ${ruler}, with every other ` +
        `party banned.`
      );
    }
    return (
      `${conflict.name} is over, and ${loser} ${how}. Its government falls with the war, ` +
      `and it will go to the polls as a ${governmentSystemLabel(s.term.targetSystem)}, ` +
      `a system ${winner} chose for it.`
    );
  }
  if (s.term.kind === "demilitarisation") {
    return (
      `${conflict.name} is over, and ${loser} ${how}. Its armouries stay shut to new ` +
      `orders for as long as the settlement holds, while what it already bought keeps arriving.`
    );
  }
  if (s.term.kind === "reunification") {
    // The loser here is whoever signed, which is NOT necessarily a Germany: the term
    // settles the question rather than landing on the country that accepted it. So the
    // line talks about Germany and leaves the signatory out of the claim.
    return (
      `${conflict.name} is over, and ${loser} ${how}. The German question is answered ` +
      `on the East's terms: the two states become one, and the settlement is carried ` +
      `into a single German government.`
    );
  }
  if (s.term.amount > 0) {
    return (
      `${conflict.name} is over, and ${loser} ${how}. The bill falls due in its own ` +
      `currency, and ${winner} collects it.`
    );
  }
  return (
    `${conflict.name} is over. ${loser} ${how}, and neither government took anything ` +
    "from the other for it."
  );
}

/**
 * The term as one labelled field value.
 *
 * `rulingPartyName` is the party a one-party conversion installs, resolved by the
 * caller because the term stores an id and this function is pure. Absent, the
 * value simply names the system, which is what a conversion that named no party
 * actually did.
 */
export function termFieldValue(term: PeaceTerm, rulingPartyName?: string | null): string {
  if (term.kind === "white_peace") return "White peace, status quo";
  if (term.kind === "indemnity") {
    return term.amount > 0
      ? `Indemnity: ${term.amount.toLocaleString("en-US")} from ${name(term.payer)}`
      : "White peace";
  }
  if (term.kind === "regime_change") {
    // `governmentSystemLabel`, not the raw key: this string is read by players,
    // and the enum reached them verbatim as "onePartyState".
    const system = governmentSystemLabel(term.targetSystem);
    return rulingPartyName
      ? `Regime change: ${system} under the ${rulingPartyName}`
      : `Regime change: ${system}`;
  }
  if (term.kind === "demilitarisation") return `Demilitarisation: ${term.turns} turns`;
  return "German reunification";
}

/**
 * The dispatch for a war that has settled.
 *
 * Built from `conflict.settlement` where there is one, and from its absence where
 * there is not: a war whose window lapsed took no term, and that reads as a white
 * peace rather than as a missing record.
 */
export function buildSettledDispatch(
  conflict: ConflictDoc,
  rulingPartyName?: string | null
): WarDispatch {
  const title = settledTitle(conflict);
  const body = settledBody(conflict, rulingPartyName);
  const s = conflict.settlement;

  const fields: NonNullable<DiscordEmbed["fields"]> = [
    {
      name: "Outcome",
      value:
        s && s.term.kind !== "white_peace"
          ? `${name(s.imposedBy)} prevailed`
          : "The front line held",
      inline: true,
    },
    {
      name: "Terms",
      value: s ? termFieldValue(s.term, rulingPartyName) : "None taken",
      inline: true,
    },
    {
      name: "Settled by",
      value: s?.path === "dictated" ? "Force of arms" : "Negotiation",
      inline: true,
    },
  ];

  return {
    title,
    body,
    embed: {
      title,
      description: body,
      color: DISCORD_COLORS.warEscalation,
      fields,
      footer: { text: DESK },
    },
  };
}
