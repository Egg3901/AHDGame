import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.speakingFee";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "takeGig",
      label: "Take the gig",
      description: "Pocket the fee for a keynote.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Standing ovation and a check",
        "Decent fee",
        "Half-empty room",
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: 40_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: 25_000 }],
        [{ type: "personalWealth", deltaAnchor: 15_000 }]
      ),
    },
    {
      id: "proBono",
      label: "Do it pro bono",
      description: "Waive the fee and bank the goodwill.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Goodwill pays off",
        "Appreciated gesture",
        "Quietly thanked",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "decline",
      label: "Decline",
      description: "Pass on the invitation.",
      outcomeTable: threeTierTable(
        "No hard feelings",
        "Organizers shrug",
        "Seen as aloof",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "ignore",
      label: "Let it lapse",
      description: "Never get back to them.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Slot quietly filled",
        "Left them hanging",
        "Burned a bridge",
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

export { handler as speakingFeeHandler };
