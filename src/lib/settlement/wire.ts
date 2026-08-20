/**
 * The German Question's dispatches to World News.
 *
 * WHAT IS AND IS NOT NEWS. Every character in the world holds a personal play,
 * so posting per action would put thousands of "someone published an op-ed"
 * lines through the channel and bury everything else in it. The public appears
 * here only in aggregate — how many took a position, and which way the street
 * moved. What gets its own post is the handful of moments that change what the
 * question IS: it opened, it reached the brink, it went to war, it settled.
 *
 * ONE EMITTER. Every post is made from the turn phase, never from the command
 * that caused it, and every one is stamped on the crisis document before it can
 * be made again. Emitting from `armLadder` or `declareWar` would put a network
 * call on a player's request path and would fire again on a retry; emitting
 * from the tick means a post reflects a board that has actually ticked, and the
 * stamp makes each moment post exactly once.
 *
 * Failure is non-fatal by construction — `sendNewsEvent` swallows its own
 * errors, and `postSettlementWire` catches around the news post as well. A
 * Discord outage must never stop a turn.
 *
 * HOUSE STYLE. Modelled on the Vietnam Desk dispatches the bot already files:
 * a short narrative title, two sentences of prose that carry no digits, a few
 * terse labelled fields for the figures, and a NAMED DESK in the footer rather
 * than the product name. Bonn Desk is this crisis's byline.
 *
 * Copy rules this file follows (they are project-wide): no calendar years and
 * no "current rate" phrasing, because the same text has to read correctly in
 * every era; and no anchor-unit figures, because those are not a player-facing
 * currency. The briefings deal in index points only, so neither can arise.
 */
import type { Db, Filter } from "mongodb";
import type { SettlementCrisisDoc } from "@/lib/db/types/settlementCrisis";
import type { SettlementPlayDoc } from "@/lib/db/types/settlementPlay";
import { getSettlementPlaysCollection } from "@/lib/db/collections";
import {
  HUNDREDTHS,
  LADDER_RUNGS,
  SETTLEMENT_WIRE_INTERVAL_TURNS,
  getInstitution,
} from "@/lib/constants/settlementCrisis";
import { defconFor, isArmed } from "./outcome";
import { DISCORD_COLORS, sendNewsEvent, type DiscordEmbed } from "@/lib/discordWebhooks";
import { createSystemNewsPost } from "@/lib/news";

/** Moments that get their own post. Each fires at most once per crisis. */
export type SettlementWireEvent = "opened" | "armed" | "war" | "settled";

const pts = (hundredths: number) => Math.round(hundredths) / HUNDREDTHS;
const signed = (points: number) => `${points >= 0 ? "+" : ""}${points.toFixed(1)}`;

/** The byline every dispatch carries, as the Vietnam Desk ones do. */
const DESK = "Bonn Desk";

export interface SettlementDispatch {
  title: string;
  /** Plain body, for the in-game news feed. */
  body: string;
  embed: DiscordEmbed;
}

/** Has enough time passed since the last briefing to file another? */
export function briefingIsDue(crisis: SettlementCrisisDoc, currentTurn: number): boolean {
  const last = crisis.lastBriefing?.turn ?? crisis.openedTurn;
  return currentTurn - last >= SETTLEMENT_WIRE_INTERVAL_TURNS;
}

/** Which way the board is leaning, in words rather than in a number. */
function standing(eastPoints: number): string {
  if (eastPoints >= 70) return "Reunification is close to carrying";
  if (eastPoints >= 55) return "Reunification holds the advantage";
  if (eastPoints > 45) return "The question is finely balanced";
  if (eastPoints > 30) return "Sovereignty holds the advantage";
  return "Sovereignty is close to locking";
}

/**
 * A headline that says what happened, not what the feature is called.
 *
 * The Vietnam dispatches read "Washington deepens its commitment in Vietnam" —
 * a sentence about the world. A recurring post titled with the crisis's own
 * name reads as a status widget instead, and gets skimmed past.
 */
function briefingTitle(eastPoints: number, delta: number): string {
  if (eastPoints >= 80) return "Reunification is within reach";
  if (eastPoints <= 20) return "Sovereignty is all but settled";
  if (Math.abs(delta) < 0.5) return "Bonn holds where it stood";
  if (delta >= 5) return "Bonn swings east";
  if (delta <= -5) return "Bonn swings west";
  return delta > 0 ? "Bonn drifts toward the East" : "Bonn drifts toward the West";
}

/** The institution that moved most since the last dispatch, for the prose. */
function moverPhrase(crisis: SettlementCrisisDoc): string {
  const moved = [...crisis.institutions].sort(
    (a, b) => Math.abs(b.lastDrift) - Math.abs(a.lastDrift)
  )[0];
  if (!moved || moved.lastDrift === 0) return "No single institution is moving on its own";
  const name = getInstitution(moved.id)?.name ?? moved.id;
  return `${name} is where Bonn's own politics are pulling hardest`;
}

/** How the swing since the last dispatch reads. */
function swingPhrase(delta: number): string {
  if (Math.abs(delta) < 0.5) return "barely moved since the last dispatch";
  const direction = delta > 0 ? "toward reunification" : "toward sovereignty";
  if (Math.abs(delta) >= 8) return `swung sharply ${direction}`;
  if (Math.abs(delta) >= 3) return `moved ${direction}`;
  return `edged ${direction}`;
}

export interface BriefingInput {
  crisis: SettlementCrisisDoc;
  currentTurn: number;
  /** Distinct characters who took a personal position since the last dispatch. */
  publicVoices: number;
}

/**
 * The periodic sentiment briefing — the one post that recurs.
 *
 * Reports only settled state: positions AFTER the tick, and an aggregate of the
 * public. That is what makes it compatible with a crisis whose log is closed —
 * a closed log withholds PENDING commitments, and there are none here.
 */
export function buildBriefing(input: BriefingInput): SettlementDispatch {
  const { crisis, publicVoices } = input;
  const east = pts(crisis.position);
  const west = Math.round((100 - east) * 10) / 10;
  const previous = pts(crisis.lastBriefing?.position ?? crisis.position);
  const delta = Math.round((east - previous) * 10) / 10;

  const heat = crisis.ladder.heat;
  const title = briefingTitle(east, delta);

  // Prose carries no digits, matching the desk style — the figures live in the
  // fields, where they can be read at a glance instead of parsed out of a
  // sentence.
  const body =
    `${standing(east)} in the four-power contest over Germany's settlement, ` +
    `having ${swingPhrase(delta)}. ${moverPhrase(crisis)}.`;

  const fields: NonNullable<DiscordEmbed["fields"]> = [
    {
      name: "Settlement",
      value: `${east.toFixed(1)} reunification / ${west.toFixed(1)} sovereignty`,
      inline: true,
    },
    { name: "Swing", value: `${signed(delta)} since the last dispatch`, inline: true },
  ];

  if (heat > 0) {
    fields.push({
      name: "Rung",
      value: `${heat}. ${LADDER_RUNGS[heat - 1] ?? "Unknown"} · DEFCON ${defconFor(heat)}`,
      inline: true,
    });
  }

  fields.push({
    name: "The board",
    value: crisis.institutions
      .map((inst) => {
        const name = getInstitution(inst.id)?.name ?? inst.id;
        const drift = pts(inst.lastDrift);
        return (
          `${name} ×${inst.weight} — ${pts(inst.position).toFixed(1)}` +
          (drift === 0 ? "" : ` (${signed(drift)})`)
        );
      })
      .join("\n"),
    inline: false,
  });

  fields.push({
    name: "Open floor",
    value:
      publicVoices === 0
        ? "Nobody took a public position."
        : `${publicVoices.toLocaleString()} ${publicVoices === 1 ? "person" : "people"} took a public position.`,
    inline: true,
  });

  return {
    title,
    body,
    embed: {
      title,
      description: body,
      color: isArmed(heat) ? DISCORD_COLORS.settlementBrink : DISCORD_COLORS.settlementBriefing,
      fields,
      footer: { text: DESK },
    },
  };
}

/** The four one-off moments. */
export function buildEventDispatch(
  event: SettlementWireEvent,
  crisis: SettlementCrisisDoc
): SettlementDispatch {
  const east = pts(crisis.position);
  const west = Math.round((100 - east) * 10) / 10;

  if (event === "opened") {
    const title = "The four powers reopen the German question";
    const body =
      "Bonn may remain a sovereign state inside NATO, or dissolve into one reunified " +
      "Germany inside the Warsaw Pact. It does not get a vote of its own — the " +
      "Bundestag, the Länder, the street and the Allied garrison each answer separately, " +
      "and the four occupying powers will spend to move them.";
    return {
      title,
      body,
      embed: {
        title,
        description: body,
        color: DISCORD_COLORS.settlementBriefing,
        fields: [
          {
            name: "Opening board",
            value: `${east.toFixed(1)} reunification / ${west.toFixed(1)} sovereignty`,
            inline: true,
          },
          { name: "Carries at", value: "85.0 · locks at 15.0", inline: true },
        ],
        footer: { text: DESK },
      },
    };
  }

  if (event === "armed") {
    const title = "The alliances mobilise on the Elbe";
    const body =
      "A superpower has forced the issue. The corridors are closed and both blocs are " +
      "paying for every turn they stand here. Nothing has been declared — but nothing " +
      "now stands between the question and a war except a decision not to take it.";
    return {
      title,
      body,
      embed: {
        title,
        description: body,
        color: DISCORD_COLORS.settlementBrink,
        fields: [
          {
            name: "Rung",
            value: `${LADDER_RUNGS.length}. ${LADDER_RUNGS[LADDER_RUNGS.length - 1]} · DEFCON 1`,
            inline: true,
          },
          {
            name: "Settlement",
            value: `${east.toFixed(1)} reunification / ${west.toFixed(1)} sovereignty`,
            inline: true,
          },
        ],
        footer: { text: DESK },
      },
    };
  }

  if (event === "war") {
    const title = "The settlement goes to war";
    const body =
      "The declaration has been made and Germany's future is no longer being argued " +
      "over — it is being fought for. The question is frozen where it stood; both " +
      "Germanies are the ground, and whoever wins takes the settlement outright, however " +
      "the meter read when the shooting started.";
    return {
      title,
      body,
      embed: {
        title,
        description: body,
        color: DISCORD_COLORS.settlementBrink,
        fields: [
          {
            name: "Frozen at",
            value: `${east.toFixed(1)} reunification / ${west.toFixed(1)} sovereignty`,
            inline: true,
          },
          { name: "Theatre", value: "Germany", inline: true },
        ],
        footer: { text: DESK },
      },
    };
  }

  const reunified = crisis.outcome === "challenger";
  const title = reunified ? "Germany is one country again" : "Bonn keeps its sovereignty";
  const body = reunified
    ? "The question has carried. The German Democratic Republic is dissolved into a " +
      "single German state, which takes its government and its alliance with it into " +
      "the Warsaw Pact."
    : "The question has closed with the Federal Republic sovereign and inside NATO. " +
      "Nothing is transferred and nothing is settled permanently — this is the status " +
      "quo holding, and the four powers may ask again.";
  return {
    title,
    body,
    embed: {
      title,
      description: body,
      color: DISCORD_COLORS.settlementSettled,
      fields: [
        {
          name: "Final",
          value: `${east.toFixed(1)} reunification / ${west.toFixed(1)} sovereignty`,
          inline: true,
        },
        { name: "Outcome", value: reunified ? "Reunification" : "Sovereignty", inline: true },
      ],
      footer: { text: DESK },
    },
  };
}

/**
 * Distinct characters who took a personal position since `sinceTurn`,
 * exclusive. Served by the `{ crisisId, turn }` index.
 */
export async function countPublicVoices(
  db: Db,
  crisis: SettlementCrisisDoc,
  sinceTurn: number,
  currentTurn: number
): Promise<number> {
  const plays = await getSettlementPlaysCollection(db);
  const ids = await plays.distinct("characterId", {
    crisisId: crisis._id,
    actor: "personal",
    turn: { $gt: sinceTurn, $lte: currentTurn },
  } as Filter<SettlementPlayDoc>);
  return ids.length;
}

/**
 * Publish one dispatch to the in-game feed and to World News.
 *
 * Returns whether it went out. Never throws: a turn must not fail because
 * Discord did.
 */
export async function postSettlementWire(dispatch: SettlementDispatch): Promise<boolean> {
  try {
    await createSystemNewsPost(dispatch.body, "general", { title: dispatch.title });
  } catch (err) {
    console.error("[Settlement] news post failed:", err);
  }
  try {
    await sendNewsEvent(dispatch.embed);
    return true;
  } catch (err) {
    console.error("[Settlement] world news webhook failed:", err);
    return false;
  }
}
