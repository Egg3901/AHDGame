import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.charityGala";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "buyTable",
      label: "Buy a table",
      description: "Sponsor a full table and put your name on it.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Generous patron headline",
        "Polite write-up",
        "Money noticed, not the cause",
        [
          { type: "favorability", delta: 5 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [
          { type: "favorability", delta: 2 },
          { type: "personalWealth", deltaAnchor: -25_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -25_000 }]
      ),
    },
    {
      id: "attendDonate",
      label: "Attend and donate modestly",
      description: "Show up, write a reasonable check.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Warm reception",
        "Pleasant evening",
        "Forgettable night",
        [
          { type: "favorability", delta: 3 },
          { type: "personalWealth", deltaAnchor: -5_000 },
        ],
        [
          { type: "favorability", delta: 1 },
          { type: "personalWealth", deltaAnchor: -5_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -5_000 }]
      ),
    },
    {
      id: "sendRegrets",
      label: "Send regrets with a note",
      description: "Decline gracefully and wish them well.",
      outcomeTable: threeTierTable(
        "Gracious note appreciated",
        "No harm done",
        "Noted absence",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the invite",
      description: "Let it sit in the pile.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Nobody notices",
        "Mild snub",
        "Host takes offense",
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

export { handler as charityGalaHandler };
