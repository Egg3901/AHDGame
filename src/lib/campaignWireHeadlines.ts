/**
 * Headline templates for the per-race campaign wire.
 *
 * These feed the ticker strip on the Blend campaign and election screens. They
 * are written in the clipped upper-case register of a wire service, matching
 * the design, and deliberately avoid em and en dashes (CLAUDE.md forbids them
 * in player-facing copy).
 *
 * Kept beside `wireEvent.ts` rather than inside it so the economy wire and the
 * race wire can grow separately.
 */

import type { PrimaryStateActionKind } from "@/lib/db/types";

/** Pick a random element from an array. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Wire register: surnames and place names run upper case in the strip. */
function up(s: string): string {
  return s.toUpperCase();
}

function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function oneDp(n: number): string {
  return Math.abs(n).toFixed(1);
}

// ── Operations level changes ────────────────────────────────────────────────

const OPS_LEVEL_TEMPLATES = [
  (c: string, lever: string, lvl: number) => `${up(c)} TAKES ${up(lever)} TO LEVEL ${lvl}`,
  (c: string, lever: string, lvl: number) => `${up(lever)} NOW LEVEL ${lvl} FOR ${up(c)}`,
  (c: string, lever: string, lvl: number) => `${up(c)} INVESTS: ${up(lever)} AT ${lvl}`,
  (c: string, lever: string, lvl: number) => `${up(c)} BUILDS OUT ${up(lever)}, LEVEL ${lvl}`,
];

export function wireHeadlineCampaignOpsLevel(
  candidate: string,
  leverLabel: string,
  level: number
): string {
  return pick(OPS_LEVEL_TEMPLATES)(candidate, leverLabel, level);
}

// ── Rallies ─────────────────────────────────────────────────────────────────

const RALLY_TEMPLATES = [
  (c: string, g: string) => `${up(c)} RALLY LANDS, SUPPORT UP ${g}`,
  (c: string, g: string) => `CROWDS TURN OUT FOR ${up(c)}, SUPPORT UP ${g}`,
  (c: string, g: string) => `${up(c)} WORKS THE ROOM: SUPPORT UP ${g}`,
  (c: string, g: string) => `${up(c)} BANKS ${g} SUPPORT ON THE STUMP`,
];

export function wireHeadlineCampaignRally(candidate: string, supportGain: number): string {
  return pick(RALLY_TEMPLATES)(candidate, oneDp(supportGain));
}

// ── Primary delegate tiers ──────────────────────────────────────────────────

const TIER_LOCKED_TEMPLATES = [
  (t: number, d: string) => `TIER ${t} DELEGATES LOCKED: ${d} AWARDED`,
  (t: number, d: string) => `${d} DELEGATES SETTLE AS TIER ${t} CLOSES`,
  (t: number, d: string) => `TIER ${t} IN THE BOOKS, ${d} DELEGATES AWARDED`,
];

export function wireHeadlinePrimaryTierLocked(tier: number, delegates: number): string {
  return pick(TIER_LOCKED_TEMPLATES)(tier, grouped(delegates));
}

// ── State calls ─────────────────────────────────────────────────────────────

const STATE_CALLED_TEMPLATES = [
  (s: string, c: string, m: string) => `${up(s)} CALLED FOR ${up(c)} BY ${m}`,
  (s: string, c: string, m: string) => `${up(c)} TAKES ${up(s)}, MARGIN ${m}`,
  (s: string, c: string, m: string) => `CALL: ${up(s)} GOES TO ${up(c)} BY ${m}`,
  (s: string, c: string, m: string) => `${up(s)} FALLS TO ${up(c)}, ${m} CLEAR`,
];

export function wireHeadlineStateCalled(
  stateName: string,
  winner: string,
  marginPp: number
): string {
  return pick(STATE_CALLED_TEMPLATES)(stateName, winner, oneDp(marginPp));
}

// ── Favorability swings ─────────────────────────────────────────────────────

const FAVORABILITY_DOWN_TEMPLATES = [
  (c: string, v: string) => `${up(c)} FAVORABILITY DOWN ${v}`,
  (c: string, v: string) => `${up(c)} SLIPS ${v} ON FAVORABILITY`,
  (c: string, v: string) => `${up(c)} SHEDS ${v} FAVORABILITY`,
  (c: string, v: string) => `OPPO LANDS ON ${up(c)}: FAVORABILITY DOWN ${v}`,
];

const FAVORABILITY_UP_TEMPLATES = [
  (c: string, v: string) => `${up(c)} FAVORABILITY UP ${v}`,
  (c: string, v: string) => `${up(c)} GAINS ${v} ON FAVORABILITY`,
  (c: string, v: string) => `${up(c)} CLIMBS ${v} IN FAVORABILITY`,
  (c: string, v: string) => `${up(c)} ADDS ${v} FAVORABILITY`,
];

export function wireHeadlineFavorabilitySwing(candidate: string, swingPp: number): string {
  const v = oneDp(swingPp);
  return swingPp < 0
    ? pick(FAVORABILITY_DOWN_TEMPLATES)(candidate, v)
    : pick(FAVORABILITY_UP_TEMPLATES)(candidate, v);
}

// ── State attacks ───────────────────────────────────────────────────────────

// Attribution is deliberate for all three kinds. An attack nobody can trace
// back to its buyer reads as a bug in the numbers rather than as a rival's
// move, so every template names both candidates and the state.
const LOCAL_FAVOURABILITY_TEMPLATES = [
  (a: string, t: string, s: string) => `${up(a)} OPENS FIRE ON ${up(t)} IN ${up(s)}`,
  (a: string, t: string, s: string) => `${up(a)} GOES NEGATIVE ON ${up(t)} ACROSS ${up(s)}`,
  (a: string, t: string, s: string) => `${up(s)} AIRWAVES TURN: ${up(a)} HITS ${up(t)}`,
  (a: string, t: string, s: string) => `${up(a)} TAKES THE FIGHT TO ${up(t)} IN ${up(s)}`,
];

const VOTE_SUPPRESSION_TEMPLATES = [
  (a: string, t: string, s: string) => `${up(a)} MOVES TO SHAVE ${up(t)}'S COUNT IN ${up(s)}`,
  (a: string, t: string, s: string) => `${up(s)} OPERATION AIMS TO HOLD ${up(t)} DOWN FOR ${up(a)}`,
  (a: string, t: string, s: string) => `${up(a)} WORKS TO CUT ${up(t)}'S ${up(s)} MARGIN`,
];

// The turnout set names the group as well. That attack lowers one group's
// turnout for everyone in the state rather than hitting one candidate, so a
// headline that hid which group would leave it untraceable.
const TURNOUT_SUPPRESSION_TEMPLATES = [
  (a: string, t: string, s: string, g: string) =>
    `${up(a)} MOVES ON ${up(g)} IN ${up(s)}, WITH ${up(t)} IN THE FRAME`,
  (a: string, t: string, s: string, g: string) =>
    `${up(s)} ${up(g)} TURNOUT TARGETED BY ${up(a)} AGAINST ${up(t)}`,
  (a: string, t: string, s: string, g: string) =>
    `${up(a)} LEANS ON ${up(g)} TURNOUT IN ${up(s)} TO BLUNT ${up(t)}`,
];

export function wireHeadlineStateAttack(
  kind: PrimaryStateActionKind,
  actor: string,
  target: string,
  stateName: string,
  bucketLabel?: string
): string {
  if (kind === "voteSuppression") {
    return pick(VOTE_SUPPRESSION_TEMPLATES)(actor, target, stateName);
  }
  if (kind === "turnoutSuppression") {
    return pick(TURNOUT_SUPPRESSION_TEMPLATES)(
      actor,
      target,
      stateName,
      bucketLabel ?? "that vote"
    );
  }
  return pick(LOCAL_FAVOURABILITY_TEMPLATES)(actor, target, stateName);
}
