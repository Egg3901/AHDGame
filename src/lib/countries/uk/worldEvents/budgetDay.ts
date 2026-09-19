/**
 * UK Budget / Autumn Statement day — national wire + mild approval swing.
 * Multi-option institutional beat for the executive (Chancellor-facing).
 * Default option is the safe/neutral path (plan §7 timeout rule).
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.ukBudgetDay",
  defaultOptionId: "steady",
  options: [
    {
      id: "steady",
      label: "Deliver a steady Budget",
      description: "Stick to the fiscal orthodoxy and take the applause politely.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Markets shrug; OBR nods",
          effects: [
            { type: "approvalDelta", delta: 1 },
            { type: "sectorDemandModifier", sectorType: "financial", pct: 2, durationTurns: 4 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Budget Day in {country}: Steady as She Goes",
            template:
              "{leader}'s Budget landed without fireworks. The OBR's forecasts were treated as gospel and gilt markets barely twitched.",
          },
        },
      ],
    },
    {
      id: "giveaway",
      label: "Splash the cash",
      description: "Announce popular giveaways and hope the gilt market forgives you.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Crowds cheer; markets wobble",
          effects: [
            { type: "approvalDelta", delta: 3 },
            { type: "sectorDemandModifier", sectorType: "retail", pct: 4, durationTurns: 4 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Budget Giveaways Light Up {country}",
            template:
              "{leader} unveiled a Budget packed with giveaways. Voters cheered; City desks muttered about fiscal credibility.",
          },
        },
      ],
    },
    {
      id: "austerity",
      label: "Tighten the purse strings",
      description: "Lean into cuts and fiscal hairshirt politics.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Bond vigilantes calm; voters bristle",
          effects: [
            { type: "approvalDelta", delta: -2 },
            { type: "sectorDemandModifier", sectorType: "financial", pct: 3, durationTurns: 4 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Austerity Budget Divides {country}",
            template:
              "{leader}'s austere Budget pleased the gilt market and enraged public-service unions in equal measure.",
          },
        },
      ],
    },
    {
      id: "uturn",
      label: "U-turn after the OBR leak",
      description: "Walk back a measure mid-afternoon and wear the credibility hit.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "OBR credibility bruise",
          effects: [{ type: "approvalDelta", delta: -3 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "Budget U-Turn Rocks {country}",
            template:
              "A mid-afternoon U-turn on Budget Day left {leader} looking flat-footed. Sketch writers filed early; the OBR kept a studied silence.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
