/**
 * World Events v1 Phase 2 executive decision event: an international summit.
 * Country scope, executive picks a stance. Per plan §2.2, no primaryStat
 * roll — each option has a single full-range (1-100) outcome tier.
 *
 * Vacant-executive safety (plan §7): `defaultOptionId` is "moderate", which
 * has no treasuryDelta at all (moderate stances carry no cost in this v1
 * catalog) — never a treasury-negative default.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.intlSummit",
  defaultOptionId: "moderate",
  options: [
    {
      id: "assertive",
      label: "Take an assertive stance",
      description: "Push hard for national interests at the summit table.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "An assertive summit stance",
          effects: [
            { type: "approvalDelta", delta: 3 },
            {
              type: "sectorDemandModifier",
              sectorType: "manufacturing",
              pct: -3,
              durationTurns: 6,
            },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Takes Hard Line at International Summit",
            template:
              "{leader} pressed {country}'s interests firmly at the summit, drawing domestic approval but some trade friction.",
          },
        },
      ],
    },
    {
      id: "moderate",
      label: "Take a moderate stance",
      description: "Seek consensus without rocking the boat.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A moderate summit stance",
          effects: [{ type: "approvalDelta", delta: 1 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Seeks Consensus at Summit",
            template:
              "{leader} took a measured, consensus-seeking approach at the international summit.",
          },
        },
      ],
    },
    {
      id: "conciliatory",
      label: "Take a conciliatory stance",
      description: "Prioritize cooperation and trade goodwill over leverage.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "A conciliatory summit stance",
          effects: [
            { type: "approvalDelta", delta: -1 },
            { type: "sectorDemandModifier", sectorType: "manufacturing", pct: 3, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Offers Cooperation at Summit",
            template:
              "{leader} emphasized cooperation at the summit, opening trade goodwill at some domestic political cost.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
