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

  const body =
    `${standing(east)}. The settlement stands at ${east.toFixed(1)} for reunification ` +
    `against ${west.toFixed(1)} for continued sovereignty, having ${swingPhrase(delta)} ` +
    `(${signed(delta)}).`;

  const fields: NonNullable<DiscordEmbed["fields"]> = crisis.institutions.map((inst) => {
    const name = getInstitution(inst.id)?.name ?? inst.id;
    const instEast = pts(inst.position);
    const drift = pts(inst.lastDrift);
    return {
      name: `${name} · ×${inst.weight}`,
      value:
        `${instEast.toFixed(1)} reunification / ${(100 - instEast).toFixed(1)} sovereignty` +
        (drift === 0 ? "" : `\nBonn's own drift: ${signed(drift)}`),
      inline: true,
    };
  });

  fields.push({
    name: "The open floor",
    value:
      publicVoices === 0
        ? "No private citizen took a public position."
        : `${publicVoices.toLocaleString()} ${publicVoices === 1 ? "person" : "people"} took a public position.`,
    inline: false,
  });

  const heat = crisis.ladder.heat;
  if (heat > 0) {
    fields.push({
      name: `Escalation · DEFCON ${defconFor(heat)}`,
      value: LADDER_RUNGS[heat - 1] ?? `Rung ${heat}`,
      inline: false,
    });
  }

  return {
    title: "The German Question — where Bonn stands",
    body,
    embed: {
      title: "The German Question — where Bonn stands",
      description: body,
      color: isArmed(heat) ? DISCORD_COLORS.settlementBrink : DISCORD_COLORS.settlementBriefing,
      fields,
      footer: { text: "A House Divided · World News" },
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
    const title = "The German Question is open";
    const body =
      "The four occupying powers have reopened the question of Germany's settlement. " +
      "Bonn may remain a sovereign state inside NATO, or dissolve into one reunified " +
      `Germany inside the Warsaw Pact. The board opens at ${east.toFixed(1)} for ` +
      `reunification against ${west.toFixed(1)} for sovereignty, and Bonn does not get ` +
      "a vote of its own — the Bundestag, the Länder, the street and the Allied garrison " +
      "each answer separately.";
    return {
      title,
      body,
      embed: {
        title,
        description: body,
        color: DISCORD_COLORS.settlementBriefing,
        footer: { text: "A House Divided · World News" },
      },
    };
  }

  if (event === "armed") {
    const title = "DEFCON 1 over Germany";
    const body =
      "A superpower has forced the issue. The alliances are mobilised on the Elbe, the " +
      "corridors are closed, and both blocs are paying for every turn they stand here. " +
      "Nothing has been declared — but nothing now stands between the question and a war " +
      "except a decision not to take it.";
    return {
      title,
      body,
      embed: {
        title,
        description: body,
        color: DISCORD_COLORS.settlementBrink,
        footer: { text: "A House Divided · World News" },
      },
    };
  }

  if (event === "war") {
    const title = "War for Germany";
    const body =
      "The declaration has been made and the settlement is no longer being argued over — " +
      "it is being fought for. The question is frozen where it stood; both Germanies are " +
      "the ground, and whoever wins the war takes the settlement outright, however the " +
      "meter read when the shooting started.";
    return {
      title,
      body,
      embed: {
        title,
        description: body,
        color: DISCORD_COLORS.settlementBrink,
        footer: { text: "A House Divided · World News" },
      },
    };
  }

  const reunified = crisis.outcome === "challenger";
  const title = reunified ? "Germany is one country again" : "Bonn stands";
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
      footer: { text: "A House Divided · World News" },
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
