import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.ceoWhistleblower";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "review",
      label: "Launch an internal review",
      description: "Commission an audit and brief the board.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Markets reassured",
        "Status quo",
        "Leak risk",
        [
          { type: "corpSentiment", delta: 8 },
          { type: "favorability", delta: -1 },
        ],
        [{ type: "corpSentiment", delta: 0 }],
        [{ type: "corpSentiment", delta: -6 }]
      ),
    },
    {
      id: "settle",
      label: "Quietly settle",
      description: "Pay to make it go away off the books.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Cash preserved",
        "Whispers remain",
        "Scandal brews",
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -2 }],
        [
          { type: "corpSentiment", delta: -6 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "cooperate",
      label: "Go public and cooperate",
      description: "Disclose the memo and invite oversight.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Transparency play",
        "Mixed markets",
        "Shareholder revolt",
        [
          { type: "favorability", delta: 4 },
          { type: "corpSentiment", delta: 2 },
        ],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -8 },
          { type: "corpSentiment", delta: -10 },
        ]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the memo",
      description: "File it and hope nobody else saw it.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Contained for now",
        "Rumors spread",
        "Whistleblower leaks",
        [{ type: "corpSentiment", delta: -2 }],
        [{ type: "corpSentiment", delta: -4 }],
        [{ type: "corpSentiment", delta: -8 }]
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

export { handler as ceoWhistleblowerHandler };
