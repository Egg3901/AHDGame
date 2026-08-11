import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.ribbonCutting";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "skip",
  options: [
    {
      id: "attend",
      label: "Show up and work the crowd",
      description: "Hold the oversized scissors yourself.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Great photos, warm crowd",
        "Pleasant turnout",
        "Sparse crowd, awkward photos",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        []
      ),
    },
    {
      id: "sendDeputy",
      label: "Send a deputy",
      description: "Let a staffer stand in for you.",
      outcomeTable: threeTierTable(
        "Office well-represented",
        "Nobody minds",
        "Noticed you skipped",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "statement",
      label: "Send a statement",
      description: "Mark the occasion in writing.",
      outcomeTable: threeTierTable(
        "Gracious words quoted",
        "Routine acknowledgment",
        "Felt impersonal",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "skip",
      label: "Skip it",
      description: "Stay off the calendar.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Forgotten by morning",
        "Mild disappointment",
        "Snub makes local news",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as ribbonCuttingHandler };
