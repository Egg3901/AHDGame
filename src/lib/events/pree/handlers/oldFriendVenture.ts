import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.oldFriendVenture";

// Wealth deltas are net of the stake (e.g. a 250K investment returning 750K
// shows as +500K).
const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "investBig",
      label: "Invest $250K",
      description: "Back the venture with serious money.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "The startup takes off",
        "Slow bleed, partial exit",
        "Total write-off",
        [{ type: "personalWealth", deltaAnchor: 500_000 }],
        [{ type: "personalWealth", deltaAnchor: -100_000 }],
        [
          { type: "personalWealth", deltaAnchor: -250_000 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
    {
      id: "smallStake",
      label: "Take a small stake ($50K)",
      description: "Show support without betting the house.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Tidy return",
        "Break-even exit",
        "Stake lost",
        [{ type: "personalWealth", deltaAnchor: 100_000 }],
        [{ type: "personalWealth", deltaAnchor: -25_000 }],
        [{ type: "personalWealth", deltaAnchor: -50_000 }]
      ),
    },
    {
      id: "decline",
      label: "Decline politely",
      description: "Wish them well and keep your money.",
      outcomeTable: threeTierTable(
        "No hard feelings",
        "Friendship cools",
        "Word gets around",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "ignore",
      label: "Leave them on read",
      description: "Don't reply to the pitch deck.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "They forget about it",
        "Awkward run-in later",
        "Burned bridge",
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

export { handler as oldFriendVentureHandler };
