/**
 * World Events v1 Phase 1 flavor event: a papal visit. Country scope, no
 * decision required (single default option) — wire-only morale flavor plus
 * a small positive approval bump. Positive-only magnitudes so the timeout
 * default is always safe/neutral (plan §7).
 *
 * Gating: the plan calls for restricting this to high-Catholic-share
 * countries "if demographic data supports it, else all countries". No
 * religious-demographic field exists in the codebase (verified by grep —
 * see Phase 1 handoff note), so this ships ungated (`eligibility: ["all"]`,
 * no `requiresCountryIds`) per the documented fallback.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.papalVisit",
  defaultOptionId: "acknowledge",
  options: [
    {
      id: "acknowledge",
      label: "State reception",
      description: "The nation hosts the visit.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A moment of national unity",
          effects: [{ type: "approvalDelta", delta: 2 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "Papal Visit Draws Crowds in {country}",
            template:
              "Large crowds turned out across {country} for a papal visit. {leader} welcomed the visit as a moment of national unity.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
