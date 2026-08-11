/**
 * World Events v1 Phase 2 executive decision event: a scientific
 * breakthrough. Country scope, executive chooses whether to fund
 * commercialization. Per plan §2.2, no primaryStat roll — each option has a
 * single full-range (1-100) outcome tier.
 *
 * Vacant-executive safety (plan §7): `defaultOptionId` is "decline", which
 * is free/neutral (zero treasuryDelta) — funding ("fund", treasury-negative)
 * is never the default.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.scientificBreakthrough",
  defaultOptionId: "decline",
  options: [
    {
      id: "fund",
      label: "Fund commercialization",
      description: "Commit federal funds to commercialize the breakthrough.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Commercialization funded",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "treasuryDelta", deltaAnchor: -20_000 },
            { type: "sectorDemandModifier", sectorType: "technology", pct: 6, durationTurns: 8 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Funds Scientific Breakthrough Commercialization",
            template:
              "{leader}'s government committed federal funds to commercialize a recent scientific breakthrough, boosting the domestic tech sector.",
          },
        },
      ],
    },
    {
      id: "decline",
      label: "Decline to fund",
      description: "Let the private sector pursue commercialization on its own.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Commercialization left to the private sector",
          effects: [{ type: "treasuryDelta", deltaAnchor: 0 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Declines to Fund Breakthrough Commercialization",
            template:
              "{leader}'s government opted not to fund commercialization of the recent scientific breakthrough, leaving it to private industry.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
