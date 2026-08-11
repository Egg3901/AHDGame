/**
 * World Events v1 Phase 0 proof-of-spine event: a national sports victory.
 * Country scope, no decision required (single default option), wire-only
 * morale flavor plus a small positive approval/treasury bump. Positive-only
 * magnitudes so the timeout default is always safe/neutral (plan §7 —
 * vacant executive must never cost the treasury).
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.sportsVictory",
  defaultOptionId: "acknowledge",
  options: [
    {
      id: "acknowledge",
      label: "National celebration",
      description: "The nation celebrates the win.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A moment of national pride",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "treasuryDelta", deltaAnchor: 5_000 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Celebrates a National Victory",
            template:
              "Crowds gathered across {country} to celebrate a national sports triumph. {leader} praised the team's performance in a brief statement.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
