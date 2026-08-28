import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

/**
 * Chip presentation for one approval modifier.
 *
 * Kept out of the component so both halves can be pinned by tests: the tone
 * decides a colour and an icon, and the title is player-facing copy. Neither
 * needs a DOM to be wrong.
 */

export type ModifierTone = "positive" | "neutral" | "negative";

const ADDRESS_TITLE = "Temporary boost from an active State of the State address (approval only)";
const METRIC_TITLE =
  "Derived from regional metric thresholds; affects approval and sector profit margins";

/**
 * One explanation per war term.
 *
 * The war block is three chips rather than one, so each needs to say what it
 * measures. A single line reading "War" told a player nothing about whether the
 * number in front of them was the front going badly or a public simply tired of
 * a war it is winning, which are opposite problems with opposite answers.
 */
const WAR_TITLES: Record<string, string> = {
  war_effort:
    "How the war is going on the ground, measured against what your side was expected to achieve from where it started. A defender holding the line scores positive; a stalled invasion scores negative. Affects approval only.",
  war_exhaustion:
    "How long the public has carried the war. Opens as a rally behind the government, becomes a cost after about a year of fighting, and heals back toward zero at the same pace once the fighting stops. Carries over into your next war. Affects approval only.",
  alliance_contribution:
    "What you are fielding in this theatre against what your co-belligerents are fielding. Only applies to a country pulled into the war by treaty. Affects approval only.",
};

const WAR_FALLBACK_TITLE =
  "How the war is going, and how long the public has carried it. Affects approval only.";

/**
 * Zero is its own tone, not a shade of negative.
 *
 * The chip used to branch on `effect > 0` alone, which painted a zero in the
 * same red as a two point penalty and gave it a downward arrow. Only the war
 * chips can reach zero and still render, and a war term that is currently a
 * wash is not costing the government anything.
 */
export function toneFor(effect: number): ModifierTone {
  if (effect > 0) return "positive";
  if (effect < 0) return "negative";
  return "neutral";
}

/** The chip's hover text: what this modifier measures. */
export function buildModifierTitle(modifier: ActiveModifier): string {
  if (modifier.source === "address") return ADDRESS_TITLE;
  if (modifier.source === "war") return WAR_TITLES[modifier.id] ?? WAR_FALLBACK_TITLE;
  return METRIC_TITLE;
}
