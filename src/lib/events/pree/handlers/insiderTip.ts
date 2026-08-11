import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.insiderTip";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "delete",
  options: [
    {
      id: "report",
      label: "Report it to regulators",
      description: "Forward the email to the securities commission.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Hailed for integrity",
        "Quiet thanks",
        "Industry calls you a snitch",
        [
          { type: "favorability", delta: 5 },
          { type: "corpSentiment", delta: 3 },
        ],
        [{ type: "favorability", delta: 2 }],
        [{ type: "corpSentiment", delta: -1 }]
      ),
    },
    {
      id: "trade",
      label: "Trade on it",
      description: "Move your personal portfolio before the news breaks.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Clean exit",
        "Profit with whispers",
        "Securities investigation",
        [{ type: "personalWealth", deltaAnchor: 400_000 }],
        [
          { type: "personalWealth", deltaAnchor: 100_000 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -250_000 },
          { type: "favorability", delta: -10 },
          { type: "infamy", delta: 8 },
        ]
      ),
    },
    {
      id: "warnRival",
      label: "Warn the rival CEO",
      description: "Tell them they have a leak.",
      outcomeTable: threeTierTable(
        "Industry goodwill",
        "Polite nod",
        "Seen as soft",
        [
          { type: "corpSentiment", delta: 4 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "corpSentiment", delta: 1 }],
        [{ type: "corpSentiment", delta: -2 }]
      ),
    },
    {
      id: "delete",
      label: "Delete the email",
      description: "Pretend you never saw it.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Gone without a trace",
        "Gone without a trace",
        "Metadata surfaces later",
        [],
        [],
        [{ type: "infamy", delta: 1 }]
      ),
    },
  ],
  async buildPayload(ctx) {
    return buildCeoCorpPayload(ctx);
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as insiderTipHandler };
