import type { CrisisEffect } from "@/lib/db/types/crisis";

/**
 * Tooltip copy for every field that appears on the crisis detail page.
 * Keep these concise (1–2 sentences) and grounded in game mechanics.
 */
export const CRISIS_TOOLTIPS: Record<string, string> = {
  status:
    "Active crises apply their effects every turn. Resolved crises are historical records only.",
  scope:
    "Global affects all countries. National affects one country. Regional affects specific states or provinces.",
  severity:
    "Derived from the total impact of all crisis effects. High-severity crises can swing elections and tank markets.",
  started: "The turn and in-game date when this crisis began. Effects start applying immediately.",
  ended:
    "The turn and in-game date when this crisis was resolved, either by player action or natural expiry.",
  duration:
    "Fixed-duration crises auto-resolve after N turns. Ongoing crises persist until a player resolves them.",
  countries:
    "The countries directly affected by this crisis. Citizens in these countries feel the approval and economic impacts.",
  regions:
    "Specific states or provinces within the affected countries. Regional crises may skip the national capital.",
  effects:
    "Each effect modifies a game stat every turn (tick) or once at onset (flat). Bars show relative strength within this crisis.",
  "effect-type":
    "Per-turn effects apply every turn while the crisis is active. One-time effects fire once at crisis start.",
  "effect-target":
    "The game stat being modified. Approval and GDP loss are the most politically consequential.",
  gdpLoss:
    "A one-time destruction of regional GDP. The dollar figure is estimated from the affected regions' total economic output.",
  inflation:
    "Crisis-driven inflation shocks feed into the national inflation rate via a 35% inertia blend. They decay naturally over time.",
  approval:
    "Government approval shifts affect election outcomes, party membership, and donor willingness. All approval segments move together.",
  profitMargin:
    "Sector profit margin changes ripple through corporate earnings, stock prices, and dividend payouts.",
  metric:
    "Generic metric effects target economic, environmental, or infrastructure indicators shown on country dashboards.",
  stat: "Character stat losses reduce a politician's SPECIAL score. Stats can be recovered through normal play and XP growth.",
  wire: "Wire messages are in-world news blurbs that appear in the player's inbox when the crisis starts or ends.",
  interaction:
    "Interactive crises let players choose a response. Each option has different mechanical effects and political consequences.",
  progress:
    "How far through the crisis duration we are. At 100% the crisis auto-resolves if it has a fixed duration.",
};

/**
 * Resolve a tooltip string for a given crisis effect.
 */
export function tooltipForEffect(effect: CrisisEffect): string {
  switch (effect.targetType) {
    case "gdpLoss":
      return CRISIS_TOOLTIPS.gdpLoss;
    case "inflation":
      return CRISIS_TOOLTIPS.inflation;
    case "approval":
      return CRISIS_TOOLTIPS.approval;
    case "profitMargin":
      return CRISIS_TOOLTIPS.profitMargin;
    case "metric":
      return CRISIS_TOOLTIPS.metric;
    case "stat":
      return CRISIS_TOOLTIPS.stat;
    default:
      return CRISIS_TOOLTIPS.effects;
  }
}
