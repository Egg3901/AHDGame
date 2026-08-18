import {
  DISCORD_COLORS,
  sendCountryGameEvent,
  sendNewsEvent,
  type DiscordEmbed,
} from "@/lib/discordWebhooks";
import { createSystemNewsPost } from "@/lib/news";
import { logWireEvent } from "@/lib/wireEvent";
import {
  rungForLevel,
  VIETNAM_LADDER_SIDES,
  type VietnamEscalationState,
  type VietnamMove,
} from "./vietnamEscalation";

/**
 * Press coverage of the Vietnam war: the in-game news feed, the in-game wire,
 * the Discord news channel and the two superpowers' own Discord channels.
 *
 * All four run on plumbing that already exists. `createSystemNewsPost` writes
 * the in-app feed, `logWireEvent` writes the in-game wire, `sendNewsEvent`
 * posts to the configured news webhook and `sendCountryGameEvent` posts to a
 * country's channel plus the global game channel. Every URL comes from
 * `gameConfig`, which is where the rest of the game keeps them. Nothing new is
 * invented here and no URL is ever written down in this repository.
 *
 * The copy is deliberately period-flat: what a wire service would have filed
 * that week, not what a narrator would say about it afterwards.
 */

export const VIETNAM_WIRE_SOURCE = "Vietnam Desk";

/** The two audiences with their own channel, keyed by country. */
export const VIETNAM_AUDIENCES = Object.keys(VIETNAM_LADDER_SIDES);

export interface VietnamHeadline {
  title: string;
  body: string;
}

interface RungCopy {
  global: VietnamHeadline;
  US: VietnamHeadline;
  RU: VietnamHeadline;
}

/**
 * One set of headlines per rung: what the world reads, what Washington reads,
 * what Moscow reads. Keyed by the rung key so a renamed level cannot silently
 * fall back to the wrong story.
 */
export const VIETNAM_RUNG_COPY: Record<string, RungCopy> = {
  advisors: {
    global: {
      title: "Foreign officers in Vietnam in growing numbers",
      body: "Both blocs now have uniformed advisers in Vietnam. Each capital insists they are trainers and technicians, and neither will say how many.",
    },
    US: {
      title: "Washington calls the Vietnam mission training",
      body: "The administration confirms an expanded advisory presence in Vietnam. No combat role has been announced, and no ceiling has been set.",
    },
    RU: {
      title: "Moscow increases assistance to Hanoi",
      body: "Soviet specialists are reported in the north. The Foreign Ministry describes the work as technical and fraternal.",
    },
  },
  materiel: {
    global: {
      title: "Arms shipments to Vietnam reach wartime volumes",
      body: "Rifles, trucks, transport aircraft and hard currency are moving to both sides in quantity. The fighting is still done by Vietnamese, with everyone else's equipment.",
    },
    US: {
      title: "Congress asks what the Vietnam aid bill is buying",
      body: "The scale of shipments has outgrown anything the administration can call training aid. Members want the figures read into the record.",
    },
    RU: {
      title: "Soviet equipment arrives in the north in quantity",
      body: "Deliveries to Hanoi have moved from advisers' stores to full military consignments. The Politburo treats the pipeline as settled policy.",
    },
  },
  tonkin_incident: {
    global: {
      title: "Naval incident reported in the Gulf of Tonkin",
      body: "A destroyer reports coming under fire in the gulf. The second report is thinner than the first and the third contradicts both.",
    },
    US: {
      title: "Gulf report goes to Congress as a resolution",
      body: "The administration has asked for a resolution granting it a free hand. Members are being asked to vote on an incident the intelligence has not settled.",
    },
    RU: {
      title: "Moscow calls the gulf incident a pretext",
      body: "The Soviet delegation disputes the American account and warns that a resolution built on it would be a decision to widen the war.",
    },
  },
  air_campaign: {
    global: {
      title: "Sustained bombing of Vietnam begins",
      body: "The air campaign is measured in sorties flown, tonnage dropped and aircrew who do not come home. It has produced no political result yet.",
    },
    US: {
      title: "Air war opens over Vietnam",
      body: "The Pentagon counts sorties. The campaign has no announced end date, and the target list is already under review for widening.",
    },
    RU: {
      title: "Soviet air defence crews report to Hanoi",
      body: "Moscow answers the bombing with missile and radar crews. The Politburo frames the deployment as defensive and permanent.",
    },
  },
  ground_commitment: {
    global: {
      title: "Combat divisions land in Vietnam",
      body: "Ground troops are ashore in division strength. Conscription stops being an argument about policy and becomes a letter arriving at somebody's house.",
    },
    US: {
      title: "Draft calls rise as divisions ship out",
      body: "The field commander says he can finish it with the troops requested. He said that about the last request as well.",
    },
    RU: {
      title: "Moscow warns of a wider war as American troops land",
      body: "The Politburo pledges to match the escalation in supply and advisers, and rules out a settlement while foreign divisions remain.",
    },
  },
  full_war: {
    global: {
      title: "Vietnam is a full war with no end in sight",
      body: "There is no ceiling left, no exit date and a body count on the evening news. The war now runs budgets, drafts and elections on both sides.",
    },
    US: {
      title: "The war has no date on it",
      body: "Everyone in the room has a plan to win it and nobody has a date. The casualty lists lengthen and the appropriations keep passing.",
    },
    RU: {
      title: "Politburo settles in for a long American war",
      body: "Moscow calculates that time and casualties favour Hanoi, and commits to sustaining the north for as long as the Americans stay.",
    },
  },
};

/**
 * Per-capital decision copy. A table rather than branches on the country id:
 * the two governments read completely differently, and adding a third patron
 * later should be a row here, not another arm of a ternary.
 */
const CAPITAL_DECISION_COPY: Record<
  string,
  { nation: string; support: string; deescalate: string }
> = {
  US: {
    nation: "Washington",
    support:
      "The administration has committed further money and materiel to Saigon. The appropriation follows, and so does the argument about it.",
    deescalate:
      "The administration is drawing down what it has committed. Hawks in both parties are calling it a climb-down.",
  },
  RU: {
    nation: "Moscow",
    support:
      "The Politburo has committed further money and materiel to Hanoi. The shipments are approved before the announcement is drafted.",
    deescalate:
      "Moscow is quietly reducing what it sends south. Hardliners describe it as abandoning an ally mid-fight.",
  },
};

/** Copy for one leader's decision, whichever way the rung then moved. */
export function vietnamMoveHeadline(countryId: string, move: VietnamMove): VietnamHeadline | null {
  const capital = CAPITAL_DECISION_COPY[countryId];
  if (!capital) return null;
  if (move === "support") {
    return { title: `${capital.nation} deepens its commitment in Vietnam`, body: capital.support };
  }
  if (move === "deescalate") {
    return {
      title: `${capital.nation} pares back its commitment in Vietnam`,
      body: capital.deescalate,
    };
  }
  return {
    title: `${capital.nation} holds its position on Vietnam`,
    body: "No new commitment and no withdrawal. The war continues on the terms already set.",
  };
}

/** The headline set for a rung, or null when the ladder is empty. */
export function vietnamRungCopy(level: number): RungCopy | null {
  const rung = rungForLevel(level);
  return rung ? (VIETNAM_RUNG_COPY[rung.key] ?? null) : null;
}

/** A headline as a Discord embed. Pure, so the copy is testable without a network. */
export function buildVietnamEmbed(headline: VietnamHeadline, level: number): DiscordEmbed {
  const rung = rungForLevel(level);
  return {
    title: headline.title,
    description: headline.body,
    color: DISCORD_COLORS.warEscalation,
    fields: rung
      ? [
          { name: "Rung", value: `${rung.level}. ${rung.label}`, inline: true },
          { name: "Theatre", value: "Vietnam", inline: true },
        ]
      : undefined,
    footer: { text: VIETNAM_WIRE_SOURCE },
  };
}

/**
 * Post a rung's headlines everywhere at once: the in-app feed and in-game wire
 * take the global story, the Discord news channel takes the same, and each
 * superpower's channel takes the story written for it.
 *
 * Fire and forget. Every send already swallows its own transport failure, and
 * the awaits here are wrapped so a webhook outage can never wedge a turn or a
 * player's crisis decision.
 */
export async function announceVietnamRung(level: number): Promise<void> {
  const copy = vietnamRungCopy(level);
  if (!copy) return;

  await Promise.allSettled([
    createSystemNewsPost(copy.global.body, "general", { title: copy.global.title }),
    logWireEvent("crisis_start", copy.global.title),
    sendNewsEvent(buildVietnamEmbed(copy.global, level)),
    // One post per capital, each getting the story written for it. Driven off
    // the ladder's own roster so a capital cannot be added to the war and then
    // silently left out of the coverage.
    ...VIETNAM_AUDIENCES.map((countryId) =>
      sendCountryGameEvent(
        countryId,
        buildVietnamEmbed(copy[countryId as keyof RungCopy] ?? copy.global, level)
      )
    ),
  ]);
}

/**
 * Post one leader's decision to their own channel, and, when the decision moved
 * the rung, the whole rung announcement on top of it.
 */
export async function announceVietnamMove(
  countryId: string,
  before: VietnamEscalationState,
  after: VietnamEscalationState,
  move: VietnamMove
): Promise<void> {
  const headline = vietnamMoveHeadline(countryId, move);
  if (headline) {
    await Promise.allSettled([
      logWireEvent("crisis_outcome", headline.title),
      sendCountryGameEvent(countryId, buildVietnamEmbed(headline, after.level)),
    ]);
  }
  if (after.level !== before.level) {
    await announceVietnamRung(after.level);
  }
}

/** The chain opening: the same coverage, framed as the story starting. */
export async function announceVietnamChainStart(level: number): Promise<void> {
  await announceVietnamRung(level);
}
