import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.memoirOffer";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "writeIt",
      label: "Write it yourself",
      description: "Months of evenings, but every word is yours.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Bestseller lists",
        "Respectable sales",
        "Panned by critics",
        [
          { type: "personalWealth", deltaAnchor: 150_000 },
          { type: "favorability", delta: 4 },
        ],
        [
          { type: "personalWealth", deltaAnchor: 50_000 },
          { type: "favorability", delta: 1 },
        ],
        [
          { type: "personalWealth", deltaAnchor: 25_000 },
          { type: "favorability", delta: -2 },
        ]
      ),
    },
    {
      id: "ghostwriter",
      label: "Hire a ghostwriter",
      description: "Bigger advance, faster turnaround, someone else's prose.",
      outcomeTable: threeTierTable(
        "Smooth launch",
        "Modest advance",
        "Ghostwriter leaks",
        [{ type: "personalWealth", deltaAnchor: 250_000 }],
        [{ type: "personalWealth", deltaAnchor: 100_000 }],
        [
          { type: "personalWealth", deltaAnchor: 50_000 },
          { type: "favorability", delta: -3 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "decline",
      label: "Decline the deal",
      description: "The story isn't finished yet.",
      outcomeTable: threeTierTable(
        "Humility plays well",
        "Nothing comes of it",
        "Nothing comes of it",
        [{ type: "favorability", delta: 1 }],
        [],
        []
      ),
    },
    {
      id: "ignore",
      label: "Let the offer lapse",
      description: "Don't return the publisher's calls.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Offer quietly expires",
        "Offer quietly expires",
        "Publisher shops a rival's book",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as memoirOfferHandler };
