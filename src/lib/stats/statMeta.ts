import { statMultiplier } from "./statMultiplier";
import {
  ENERGY_BASE_ACTION_CAP,
  ENERGY_MAX_ACTION_CAP,
  ENERGY_BASE_HOARD_THRESHOLD,
  ENERGY_MAX_HOARD_THRESHOLD,
  EFFICACY_PIVOT,
  STAT_MIN,
  STAT_MAX,
  clampStat,
  type StatKey,
} from "./statsConstants";

/** Player-facing label and one-line blurb for each stat. */
export const STAT_META: Record<StatKey, { label: string; blurb: string }> = {
  charisma: {
    label: "Charisma",
    blurb:
      "Boosts political-influence gained per Campaign, favorability gained per ad, relationship/favor earned when courting NPP politicians, and powers the 'Remain above the fray' debate strategy.",
  },
  debate: {
    label: "Debate",
    blurb:
      "Powers the 'Attack' debate strategy and boosts overall debate scoring. Raised by the Debate Prep action and by debating in elections (the winner learns more); decays by 1 every 72 hours if you stop practicing.",
  },
  energy: {
    label: "Energy",
    blurb:
      "Raises the ceiling on your action stockpile (200 → 250) and how far you can bank actions before the hoarding penalty starts biting (100 → 125). It does not change how many actions a turn hands you. A new character starts with 25 and earns a few more each turn, so this only matters once you are saving them up. Grows when you stay active across the turn, and erodes during quiet stretches.",
  },
  fundraising: {
    label: "Fundraising",
    blurb:
      "Increases the money raised by each Fundraise and lowers the cost of expanding your donor network.",
  },
  businessAcumen: {
    label: "Business Acumen",
    blurb:
      "Lowers the growth cost of sectors in any corporation you run as CEO and softens the bite of high interest rates on that cost. Grows while you hold a CEO seat — faster when the corp is more profitable — and slips when you don't.",
  },
  statecraft: {
    label: "Statecraft",
    blurb:
      "Raises party-whip success (~±9 pts), lengthens your filibusters, strengthens ministerial policy effects, and boosts the 'Tout accomplishments' debate strategy (though Tout's payout depends more on your legislative record than your Statecraft score). Trained by whipping and invoking filibusters.",
  },
  intellect: {
    label: "Intellect",
    blurb:
      "Lowers Quick/Full poll costs and softens the rising fund cost of repeated Campaigning. Running polls also trains this stat.",
  },
};

/** Linear interpolation across the legal [1, 10] stat band. */
function lerpByStat(value: number, atMin: number, atMax: number): number {
  const t = (clampStat(value) - STAT_MIN) / (STAT_MAX - STAT_MIN);
  return atMin + (atMax - atMin) * t;
}

/**
 * Short, stat-specific summary of the CURRENT mechanical bonus at a given stat
 * value. Energy reports its concrete action-cap / bank numbers (it doesn't use
 * the efficacy multiplier); every other stat reports its efficacy as a
 * multiplier. `label` is for inline display, `detail` for the tooltip.
 *
 * The multiplier is deliberately NOT a signed percentage here. The efficacy
 * curve pivots at 5.5, so a freshly opened creator (every stat on the 1 floor)
 * rendered as seven rows of "-18%", which reads as seven penalties rather than
 * as a build that has not been paid for yet. "0.82x" carries exactly the same
 * information without framing the starting state as damage; the tooltip still
 * spells out the comparison against baseline.
 */
export function statBonus(key: StatKey, value: number): { label: string; detail: string } {
  if (key === "energy") {
    const cap = Math.round(lerpByStat(value, ENERGY_BASE_ACTION_CAP, ENERGY_MAX_ACTION_CAP));
    const bank = Math.round(
      lerpByStat(value, ENERGY_BASE_HOARD_THRESHOLD, ENERGY_MAX_HOARD_THRESHOLD)
    );
    return { label: `${cap} cap`, detail: `${cap} action stockpile cap · bank up to ${bank}` };
  }
  const mult = statMultiplier(value);
  const pct = Math.round((mult - 1) * 100);
  const signed = `${pct > 0 ? "+" : ""}${pct}%`;
  return {
    label: `${mult.toFixed(2)}x`,
    detail: `${mult.toFixed(2)}x effectiveness (${signed} vs. the baseline at ${EFFICACY_PIVOT})`,
  };
}
